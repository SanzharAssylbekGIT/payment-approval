// Вычисление балансов из журнала Transaction. Остатки нигде не хранятся —
// всегда агрегат (единственный источник правды). Все суммы — тиыны (BigInt).
//
// Знак суммы транзакции: + приток на счёт, − отток со счёта.
//   Баланс счёта   = Σ amount по accountId.
//   Баланс проекта = Σ amount по projectId (на 7366/0175): «приток от клиента −
//                    выплаты получателям». «+» клиент заплатил, не выплачено;
//                    «−» выплачено, клиент ещё не заплатил (DECISIONS §6).

import { prisma } from "@/lib/db";
import type { LedgerKind } from "@prisma/client";

export interface AccountBalance {
  id: string;
  code: string;
  name: string;
  kind: string;
  balance: bigint;
}

// Остатки по всем счетам компании.
export async function accountBalances(entityId: string): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({ where: { entityId }, orderBy: { code: "asc" } });
  const grouped = await prisma.transaction.groupBy({
    by: ["accountId"],
    where: { entityId },
    _sum: { amount: true },
  });
  const sumByAccount = new Map(grouped.map((g) => [g.accountId, g._sum.amount ?? 0n]));
  return accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    kind: a.kind,
    balance: sumByAccount.get(a.id) ?? 0n,
  }));
}

// Остаток одного счёта по коду (например «6890»).
export async function accountBalanceByCode(entityId: string, code: string): Promise<bigint> {
  const account = await prisma.account.findUnique({ where: { entityId_code: { entityId, code } } });
  if (!account) return 0n;
  const agg = await prisma.transaction.aggregate({ where: { entityId, accountId: account.id }, _sum: { amount: true } });
  return agg._sum.amount ?? 0n;
}

// Баланс одного проекта.
export async function projectBalance(projectId: string): Promise<bigint> {
  const agg = await prisma.transaction.aggregate({ where: { projectId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0n;
}

// Балансы проектов разом (map projectId → balance) — для деревьев/списков.
export async function projectBalances(entityId: string): Promise<Map<string, bigint>> {
  const grouped = await prisma.transaction.groupBy({
    by: ["projectId"],
    where: { entityId, projectId: { not: null } },
    _sum: { amount: true },
  });
  return new Map(grouped.map((g) => [g.projectId as string, g._sum.amount ?? 0n]));
}

// Баланс получателя внутри проекта (сколько ему фактически выплачено = |отток|).
export async function recipientPaid(recipientId: string): Promise<bigint> {
  const agg = await prisma.transaction.aggregate({
    where: { recipientId, kind: "PAYOUT" },
    _sum: { amount: true },
  });
  // Выплаты отрицательны; возвращаем модуль как «выплачено».
  return -(agg._sum.amount ?? 0n);
}

// Баланс леджера (книги): сумма балансов всех его проектов.
export async function ledgerBalance(ledgerId: string): Promise<bigint> {
  const projects = await prisma.project.findMany({ where: { ledgerId }, select: { id: true } });
  if (projects.length === 0) return 0n;
  const agg = await prisma.transaction.aggregate({
    where: { projectId: { in: projects.map((p) => p.id) } },
    _sum: { amount: true },
  });
  return agg._sum.amount ?? 0n;
}

// Балансы леджеров по виду (COST_7366 / DEPOSIT_INFLUENCE / RESERVE_COMMERCIAL / SPECPROJECT_0175).
export async function ledgerBalancesByKind(entityId: string): Promise<Record<LedgerKind, bigint>> {
  const ledgers = await prisma.ledger.findMany({ where: { entityId } });
  const result = {} as Record<LedgerKind, bigint>;
  for (const l of ledgers) {
    result[l.kind] = await ledgerBalance(l.id);
  }
  return result;
}
