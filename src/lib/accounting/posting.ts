// Проводки в журнал Transaction. Все суммы — тиыны (BigInt), части ВСЕГДА
// сходятся к целому (остаток округления уходит в маржу). DECISIONS §4.

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

export class PostingError extends Error {}

// Клиент БД: либо общий prisma, либо транзакционный (для атомарных цепочек).
type Db = Prisma.TransactionClient | typeof prisma;

// Пропорциональная доля: floor(value * num / den). Без float.
function proportion(value: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  return (value * num) / den;
}

// Проводка выплаты по заявке (вызывается при отметке «оплачено»).
// Создаёт отток со счёта вида расхода; для проектных — тегирует проект/получателя.
// Возвращает созданную транзакцию. Принимает транзакционный клиент (markPaid
// оборачивает claim статуса + проводку в один $transaction).
export async function postRequestPayout(user: AuthenticatedUser, requestId: string, occurredAt: Date, db: Db = prisma) {
  const req = await db.paymentRequest.findFirst({
    where: { id: requestId, entityId: user.entityId },
    include: { expenseType: true },
  });
  if (!req) throw new PostingError("Заявка не найдена");

  const account = await db.account.findUnique({
    where: { entityId_code: { entityId: user.entityId, code: accountCodeForKind(req.expenseType.accountKind) } },
  });
  if (!account) throw new PostingError("Счёт для вида расхода не найден");

  // Идемпотентность: не дублируем выплату по заявке.
  const existing = await db.transaction.findFirst({ where: { paymentRequestId: req.id, kind: "PAYOUT" } });
  if (existing) return existing;

  const tx = await db.transaction.create({
    data: {
      entityId: user.entityId,
      accountId: account.id,
      kind: "PAYOUT",
      amount: -req.amount, // отток
      occurredAt,
      description: `Выплата по заявке ${req.number}: ${req.purpose}`,
      projectId: req.projectId,
      recipientId: req.recipientId,
      paymentRequestId: req.id,
    },
  });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "PAYOUT_POSTED", targetType: "Transaction", targetId: tx.id, comment: `Проведена выплата по ${req.number}` });
  return tx;
}

// Маппинг вида счёта → код счёта.
function accountCodeForKind(kind: string): string {
  switch (kind) {
    case "MAIN": return "6890";
    case "PROJECT_COST": return "7366";
    case "VAT": return "3098";
    case "SPECPROJECT": return "0175";
    default: return "6890";
  }
}

export interface AllocationResult {
  vatAmount: bigint;
  costAmount: bigint;
  marginAmount: bigint;
  ratioBps: number;
}

// Разнесение поступления от клиента по смете (DECISIONS §4).
// P приходит на 6890 (обычные услуги) или 0175 (спецпроект). Дробится
// пропорционально доле P от полной суммы сметы (clientPriceGross):
//   vat  = floor(estVat  * P / estGross)   → переводится на 3098
//   cost = floor(estCost * P / estGross)   → переводится на 7366 (к проекту)
//   margin = P − vat − cost                 → остаётся (остаток округления тут)
// Для спецпроекта (0175): на 3098 уходит только НДС, cost+margin остаются на 0175.
export async function postIncomingAllocation(user: AuthenticatedUser, incomingId: string): Promise<AllocationResult> {
  const incoming = await prisma.incoming.findFirst({
    where: { id: incomingId, entityId: user.entityId },
    include: { project: { include: { estimate: { include: { currentVersion: true } }, ledger: true } } },
  });
  if (!incoming) throw new PostingError("Поступление не найдено");
  if (!incoming.projectId || !incoming.project) throw new PostingError("Поступление не привязано к проекту");

  const version = incoming.project.estimate?.currentVersion;
  if (!version) throw new PostingError("У проекта нет сметы — нельзя разнести (DECISIONS §5)");
  if (version.clientPriceGross <= 0n) throw new PostingError("Сумма сметы равна нулю");

  const P = incoming.amount;
  const vat = proportion(version.vatAmount, P, version.clientPriceGross);
  const cost = proportion(version.costAmount, P, version.clientPriceGross);
  const margin = P - vat - cost; // остаток округления — в маржу
  const ratioBps = Number((P * 10000n) / version.clientPriceGross);

  const isSpec = incoming.project.ledger.kind === "SPECPROJECT_0175";
  const mainCode = isSpec ? "0175" : "6890";

  const [mainAcc, vatAcc, costAcc] = await Promise.all([
    prisma.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: mainCode } } }),
    prisma.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: "3098" } } }),
    prisma.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: "7366" } } }),
  ]);
  if (!mainAcc || !vatAcc || !costAcc) throw new PostingError("Не найдены счета");

  // projectId помечаем ТОЛЬКО на движениях по леджеру проекта (баланс проекта =
  // сумма по projectId). Для обычных услуг это себестоимость на 7366. Для
  // спецпроекта — сам счёт 0175 (доход+себест.+маржа), поэтому приток и вывод
  // НДС с 0175 относятся к проекту. Движения по 6890/3098 — счёт-уровень, без projectId.
  const pid = incoming.projectId;
  const mainLegProjectId = isSpec ? pid : null;

  await prisma.$transaction(async (db) => {
    // Claim-guard от двойного разнесения (двойной клик / гонка / stale-вкладка):
    // помечаем ALLOCATED атомарно; если поступление уже не UNALLOCATED —
    // второй вызов не проведёт ничего. Под READ COMMITTED конкурирующая
    // транзакция ждёт row lock, перечитывает предикат и получает count 0.
    const claimed = await db.incoming.updateMany({
      where: { id: incoming.id, status: "UNALLOCATED" },
      data: { status: "ALLOCATED" },
    });
    if (claimed.count === 0) throw new PostingError("Поступление уже разнесено");

    const alloc = await db.allocation.create({
      data: { incomingId: incoming.id, estimateVersionId: version.id, vatAmount: vat, costAmount: cost, marginAmount: margin, ratioBps },
    });
    const base = { entityId: user.entityId, occurredAt: incoming.receivedAt, incomingId: incoming.id, allocationId: alloc.id };

    // Поступление на основной счёт (6890 или 0175).
    await db.transaction.create({ data: { ...base, accountId: mainAcc.id, kind: "CLIENT_INCOMING", amount: P, projectId: mainLegProjectId, description: "Поступление от клиента" } });
    // НДС: отток с основного, приток на 3098.
    if (vat > 0n) {
      await db.transaction.create({ data: { ...base, accountId: mainAcc.id, kind: "VAT_TRANSFER", amount: -vat, projectId: mainLegProjectId, description: "Перевод НДС → 3098" } });
      await db.transaction.create({ data: { ...base, accountId: vatAcc.id, kind: "VAT_TRANSFER", amount: vat, description: "НДС с поступления" } });
    }
    // Себестоимость: для обычных услуг переводим на 7366 (помечаем проектом);
    // для спецпроекта отдельного перевода нет (всё остаётся на 0175).
    if (!isSpec && cost > 0n) {
      await db.transaction.create({ data: { ...base, accountId: mainAcc.id, kind: "COST_TRANSFER", amount: -cost, description: "Перевод себестоимости → 7366" } });
      await db.transaction.create({ data: { ...base, accountId: costAcc.id, kind: "COST_TRANSFER", amount: cost, projectId: pid, description: "Себестоимость проекта" } });
    }
    // Маржа остаётся на основном счёте (отдельной транзакции нет — это остаток).
    // Статус ALLOCATED уже проставлен claim-guard'ом в начале транзакции.
  });

  await writeAudit({ entityId: user.entityId, userId: user.id, action: "INCOMING_ALLOCATED", targetType: "Incoming", targetId: incoming.id, comment: `Разнесено: НДС ${vat}, себест. ${cost}, маржа ${margin} (тиын)` });
  return { vatAmount: vat, costAmount: cost, marginAmount: margin, ratioBps };
}
