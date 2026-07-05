// Сметы: создание/версионирование + пересчёт разнесений (DECISIONS §1, §1.1).
// Смета — источник правды для разнесения поступлений. Любое изменение создаёт
// НОВУЮ версию (кто/когда/причина), после чего уже разнесённые поступления
// пере-разносятся пропорционально новой смете (ADJUSTMENT-проводки на дельты).

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hasRole } from "@/lib/auth/permissions";
import { projectScopeFilter } from "@/lib/projects/scope";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { BloggerDeliverable, EstimateChangeReason, Prisma } from "@prisma/client";

export class EstimateError extends Error {}

// НДС Казахстана 16% в цене (ставка 2026): vat = gross × 16/116 (half-up до тиына).
// Ставка меняется ТОЛЬКО здесь и в живых расчётах форм (16/116).
export function vatFromGross(gross: bigint): bigint {
  return (gross * 16n + 58n) / 116n;
}

function proportion(value: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  return (value * num) / den;
}

export interface EstimateLineInput {
  title: string;
  amountTiyn: bigint;
  isCategory: boolean; // категория себестоимости без конкретного получателя
  // Продакшн-резерв по строке (блогер × опция): часть себестоимости, уходит
  // в продакшн-депозит (Σ резервов строк = depositAmount версии).
  reserveTiyn?: bigint | null;
  // Сделка (DECISIONS §14): блогер из базы, форматы, прайс на момент сделки.
  bloggerId?: string | null;
  deliverables?: BloggerDeliverable[];
  customDeliverable?: string | null;
  baseFeeTiyn?: bigint | null; // Σ прайса по выбранным форматам (для скидки)
}

export interface EstimateInput {
  clientPriceGrossTiyn: bigint;
  lines: EstimateLineInput[];
  reason: EstimateChangeReason;
  comment?: string | null;
}

// Проект в области видимости пользователя (единое правило §10 — scope.ts).
export async function getScopedProject(user: AuthenticatedUser, projectId: string) {
  return prisma.project.findFirst({
    where: { id: projectId, entityId: user.entityId, ...projectScopeFilter(user) },
    include: { ledger: true, client: true },
  });
}

// Создание новой версии сметы (v1 или ревизия) + пересчёт разнесений.
export async function saveEstimateVersion(user: AuthenticatedUser, projectId: string, input: EstimateInput) {
  if (!hasRole(user, "ACCOUNT_MANAGER", "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO")) {
    throw new EstimateError("Нет прав вести сметы");
  }
  const project = await getScopedProject(user, projectId);
  if (!project) throw new EstimateError("Проект не найден");

  const gross = input.clientPriceGrossTiyn;
  if (gross <= 0n) throw new EstimateError("Цена клиенту должна быть больше нуля");
  if (input.lines.length === 0) throw new EstimateError("Добавьте хотя бы одну строку себестоимости");
  for (const l of input.lines) {
    if (!l.title.trim()) throw new EstimateError("У каждой строки должно быть название");
    if (l.amountTiyn <= 0n) throw new EstimateError(`Строка «${l.title}»: сумма должна быть больше нуля`);
    if ((l.reserveTiyn ?? 0n) < 0n) throw new EstimateError(`Строка «${l.title}»: резерв не может быть отрицательным`);
  }

  const vat = vatFromGross(gross);
  const net = gross - vat;
  // Себестоимость = гонорары + продакшн-резервы строк.
  const cost = input.lines.reduce((s, l) => s + l.amountTiyn + (l.reserveTiyn ?? 0n), 0n);
  // Депозит продакшна версии = Σ построчных резервов (инвариант DECISIONS §14.5).
  const depositTotal = input.lines.reduce((s, l) => s + (l.reserveTiyn ?? 0n), 0n);
  const margin = net - cost;
  if (cost > net) throw new EstimateError("Себестоимость больше цены без НДС — проверьте суммы");

  const result = await prisma.$transaction(async (db) => {
    // Смета проекта (одна, история — в версиях).
    let estimate = await db.estimate.findUnique({ where: { projectId: project.id } });
    if (!estimate) {
      estimate = await db.estimate.create({ data: { entityId: user.entityId, projectId: project.id } });
    }

    const last = await db.estimateVersion.findFirst({
      where: { estimateId: estimate.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const versionNo = (last?.version ?? 0) + 1;

    const version = await db.estimateVersion.create({
      data: {
        estimateId: estimate.id,
        version: versionNo,
        clientPriceGross: gross,
        clientPriceNet: net,
        vatAmount: vat,
        costAmount: cost,
        marginAmount: margin,
        depositAmount: depositTotal,
        reason: versionNo === 1 ? "INITIAL" : input.reason,
        comment: input.comment ?? null,
        createdById: user.id,
      },
    });

    // Ревизия из простой формы не передаёт сделочные поля строк (опция, прайс) —
    // наследуем их от текущей версии по совпадению названия строки, если во
    // входе они не заданы явно. Получатель ищется по имени, поэтому связь
    // с блогером (Recipient.bloggerId) переживает ревизию сама.
    const prevLines = estimate.currentVersionId
      ? await db.estimateLine.findMany({ where: { versionId: estimate.currentVersionId } })
      : [];
    const prevByTitle = new Map(prevLines.map((p) => [p.title, p]));

    // Строки: для не-категорий находим/создаём получателя проекта по имени
    // (+ связь со справочником блогеров, если строка пришла из базы цен).
    for (const l of input.lines) {
      let recipientId: string | null = null;
      if (!l.isCategory) {
        const name = l.title.trim();
        const existing = await db.recipient.findFirst({ where: { projectId: project.id, name } });
        if (existing) {
          recipientId = existing.id;
          if (l.bloggerId && !existing.bloggerId) {
            await db.recipient.update({ where: { id: existing.id }, data: { bloggerId: l.bloggerId } });
          }
        } else {
          recipientId = (
            await db.recipient.create({
              data: {
                entityId: user.entityId,
                projectId: project.id,
                name,
                kind: project.serviceType === "INFLUENCE" ? "BLOGGER" : "CONTRACTOR",
                bloggerId: l.bloggerId ?? null,
              },
            })
          ).id;
        }
      }
      const prev = prevByTitle.get(l.title.trim());
      const inherit =
        prev && !l.bloggerId && (l.deliverables?.length ?? 0) === 0 && !l.customDeliverable ? prev : null;
      await db.estimateLine.create({
        data: {
          versionId: version.id,
          kind: l.isCategory ? "CATEGORY" : "RECIPIENT",
          title: l.title.trim(),
          plannedAmount: l.amountTiyn,
          reserveAmount: l.reserveTiyn ?? 0n,
          recipientId,
          deliverables: l.deliverables?.length ? l.deliverables : (inherit?.deliverables ?? []),
          customDeliverable: l.customDeliverable ?? inherit?.customDeliverable ?? null,
          baseFee: l.baseFeeTiyn ?? inherit?.baseFee ?? null,
        },
      });
    }

    await db.estimate.update({ where: { id: estimate.id }, data: { currentVersionId: version.id } });

    // Ревизия (v2+): пере-разнести уже полученные поступления по новой смете.
    if (versionNo > 1) {
      await recalcAllocations(db, user, project.id, project.ledger.kind === "SPECPROJECT_0175", version);
    }

    return version;
  });

  await writeAudit({
    entityId: user.entityId,
    userId: user.id,
    action: result.version === 1 ? "ESTIMATE_CREATED" : "ESTIMATE_REVISED",
    targetType: "Estimate",
    targetId: project.id,
    comment:
      result.version === 1
        ? `Смета v1: цена ${gross} тиын, себестоимость ${cost}`
        : `Смета v${result.version} (${input.reason}): цена ${gross} тиын, себестоимость ${cost}`,
  });

  return result;
}

type Db = Prisma.TransactionClient;

// Пересчёт разнесений под новую версию: на каждую дельту НДС/себестоимости/
// депозита — ADJUSTMENT-проводки; Allocation обновляется на новые части
// (DECISIONS §1.1, §19). Депозитная дельта двигает деньги между котлом проекта
// и депозитом продакшна (нога копилки тегируется ledgerId).
async function recalcAllocations(
  db: Db,
  user: AuthenticatedUser,
  projectId: string,
  isSpec: boolean,
  version: { id: string; version: number; clientPriceGross: bigint; vatAmount: bigint; costAmount: bigint; depositAmount: bigint },
) {
  const allocations = await db.allocation.findMany({
    where: { incoming: { projectId } },
    include: { incoming: true },
  });
  if (allocations.length === 0) return;

  const mainCode = isSpec ? "0175" : "6890";
  const [mainAcc, vatAcc, costAcc, depositLedger] = await Promise.all([
    db.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: mainCode } } }),
    db.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: "3098" } } }),
    db.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: "7366" } } }),
    db.ledger.findUnique({ where: { entityId_kind: { entityId: user.entityId, kind: "DEPOSIT_INFLUENCE" } } }),
  ]);
  if (!mainAcc || !vatAcc || !costAcc) throw new EstimateError("Не найдены счета для пересчёта");

  for (const a of allocations) {
    const P = a.incoming.amount;
    const newVat = proportion(version.vatAmount, P, version.clientPriceGross);
    const newCost = proportion(version.costAmount, P, version.clientPriceGross);
    const newMargin = P - newVat - newCost;
    const newDeposit = isSpec ? 0n : proportion(version.depositAmount, P, version.clientPriceGross);
    const dVat = newVat - a.vatAmount;
    const dCost = newCost - a.costAmount;
    const dDeposit = newDeposit - a.depositAmount;

    const base = {
      entityId: user.entityId,
      kind: "ADJUSTMENT" as const,
      occurredAt: new Date(),
      incomingId: a.incomingId,
      allocationId: a.id,
      description: `Пересчёт разнесения по смете v${version.version}`,
    };

    if (isSpec) {
      // Спецпроект: на 0175 живут P − НДС (cost+margin внутри). Меняется только НДС.
      if (dVat !== 0n) {
        await db.transaction.create({ data: { ...base, accountId: mainAcc.id, amount: -dVat, projectId } });
        await db.transaction.create({ data: { ...base, accountId: vatAcc.id, amount: dVat } });
      }
    } else {
      // Обычная услуга: 6890 держит маржу; 3098 — НДС; 7366 (с проектом) — себестоимость.
      const dMain = -(dVat + dCost);
      if (dMain !== 0n) await db.transaction.create({ data: { ...base, accountId: mainAcc.id, amount: dMain } });
      if (dVat !== 0n) await db.transaction.create({ data: { ...base, accountId: vatAcc.id, amount: dVat } });
      if (dCost !== 0n) await db.transaction.create({ data: { ...base, accountId: costAcc.id, amount: dCost, projectId } });
      // Дельта депозита: котёл проекта ↔ депозит продакшна (обе ноги на 7366).
      if (dDeposit !== 0n) {
        if (!depositLedger) throw new EstimateError("Не найден депозит продакшна (леджер DEPOSIT_INFLUENCE)");
        await db.transaction.create({ data: { ...base, accountId: costAcc.id, amount: -dDeposit, projectId } });
        await db.transaction.create({ data: { ...base, accountId: costAcc.id, amount: dDeposit, projectId, ledgerId: depositLedger.id } });
      }
    }

    await db.allocation.update({
      where: { id: a.id },
      data: {
        vatAmount: newVat,
        costAmount: newCost,
        marginAmount: newMargin,
        depositAmount: newDeposit,
        ratioBps: Number((P * 10000n) / version.clientPriceGross),
        estimateVersionId: version.id,
      },
    });
  }
}
