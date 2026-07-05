// Резерв коммерческого продакшна (CLAUDE.md §5, DECISIONS §19): неистраченный
// остаток себестоимости Video/Photo-проекта при закрытии уходит в копилку
// RESERVE_COMMERCIAL; при переоткрытии возвращается в котёл проекта.
// Обе ноги на счёте 7366 (счёт не меняется); нога копилки тегируется ledgerId
// и не входит в баланс проекта. Вызывается ВНУТРИ $transaction вместе с
// claim-guard смены статуса проекта (projects/actions.ts).

import type { LedgerKind, Prisma, PrismaClient, ServiceType } from "@prisma/client";

type Db = Prisma.TransactionClient | PrismaClient;

export interface ReserveProjectRef {
  id: string;
  name: string;
  serviceType: ServiceType;
  ledgerKind: LedgerKind;
}

// Закрытие: положительный остаток котла проекта → резерв. Возвращает сумму.
export async function transferVpRemainderOnClose(db: Db, entityId: string, project: ReserveProjectRef): Promise<bigint> {
  if (project.serviceType !== "VIDEO_PHOTO" || project.ledgerKind !== "COST_7366") return 0n;
  const agg = await db.transaction.aggregate({ where: { projectId: project.id, ledgerId: null }, _sum: { amount: true } });
  const balance = agg._sum.amount ?? 0n;
  if (balance <= 0n) return 0n;

  const [reserve, acc7366] = await Promise.all([
    db.ledger.findUnique({ where: { entityId_kind: { entityId, kind: "RESERVE_COMMERCIAL" } } }),
    db.account.findUnique({ where: { entityId_code: { entityId, code: "7366" } } }),
  ]);
  if (!reserve || !acc7366) return 0n;

  const base = { entityId, accountId: acc7366.id, kind: "RESERVE_FUNDING" as const, occurredAt: new Date() };
  await db.transaction.create({ data: { ...base, amount: -balance, projectId: project.id, description: "Остаток себестоимости → резерв ком. продакшна" } });
  await db.transaction.create({ data: { ...base, amount: balance, projectId: project.id, ledgerId: reserve.id, description: `Остаток по закрытому проекту: ${project.name}` } });
  return balance;
}

// Переоткрытие: что проект держит в резерве (Σ его тегированных RESERVE_FUNDING,
// закрытия минус возвраты) — возвращаем в котёл. Возвращает сумму.
export async function returnReserveOnReopen(db: Db, entityId: string, project: ReserveProjectRef): Promise<bigint> {
  if (project.serviceType !== "VIDEO_PHOTO" || project.ledgerKind !== "COST_7366") return 0n;

  const [reserve, acc7366] = await Promise.all([
    db.ledger.findUnique({ where: { entityId_kind: { entityId, kind: "RESERVE_COMMERCIAL" } } }),
    db.account.findUnique({ where: { entityId_code: { entityId, code: "7366" } } }),
  ]);
  if (!reserve || !acc7366) return 0n;

  const agg = await db.transaction.aggregate({
    where: { projectId: project.id, ledgerId: reserve.id, kind: "RESERVE_FUNDING" },
    _sum: { amount: true },
  });
  const held = agg._sum.amount ?? 0n;
  if (held <= 0n) return 0n;

  const base = { entityId, accountId: acc7366.id, kind: "RESERVE_FUNDING" as const, occurredAt: new Date() };
  await db.transaction.create({ data: { ...base, amount: -held, projectId: project.id, ledgerId: reserve.id, description: `Возврат при переоткрытии: ${project.name}` } });
  await db.transaction.create({ data: { ...base, amount: held, projectId: project.id, description: "Возврат остатка из резерва (проект переоткрыт)" } });
  return held;
}
