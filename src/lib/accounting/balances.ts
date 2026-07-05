// Вычисление балансов из журнала Transaction. Остатки нигде не хранятся —
// всегда агрегат (единственный источник правды). Все суммы — тиыны (BigInt).
//
// Знак суммы транзакции: + приток на счёт, − отток со счёта.
//   Баланс счёта   = Σ amount по accountId.
//   Баланс проекта = Σ amount по projectId (на 7366/0175): «приток от клиента −
//                    выплаты получателям». «+» клиент заплатил, не выплачено;
//                    «−» выплачено, клиент ещё не заплатил (DECISIONS §6).
//   Копилки (депозит/резерв): движения тегируются ledgerId и НЕ входят в баланс
//   проекта (projectId там — контекст). Баланс копилки = Σ amount по ledgerId.

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

// Баланс одного проекта (движения копилок не считаем).
export async function projectBalance(projectId: string): Promise<bigint> {
  const agg = await prisma.transaction.aggregate({ where: { projectId, ledgerId: null }, _sum: { amount: true } });
  return agg._sum.amount ?? 0n;
}

// Балансы проектов разом (map projectId → balance) — для деревьев/списков.
export async function projectBalances(entityId: string): Promise<Map<string, bigint>> {
  const grouped = await prisma.transaction.groupBy({
    by: ["projectId"],
    where: { entityId, projectId: { not: null }, ledgerId: null },
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

// Баланс леджера (книги): балансы его проектов + движения, тегированные самим
// леджером (для депозитов/резервов проектов нет — только тегированные движения).
export async function ledgerBalance(ledgerId: string): Promise<bigint> {
  const projects = await prisma.project.findMany({ where: { ledgerId }, select: { id: true } });
  const [byProjects, tagged] = await Promise.all([
    projects.length > 0
      ? prisma.transaction.aggregate({
          where: { projectId: { in: projects.map((p) => p.id) }, ledgerId: null },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: 0n } }),
    prisma.transaction.aggregate({ where: { ledgerId }, _sum: { amount: true } }),
  ]);
  return (byProjects._sum.amount ?? 0n) + (tagged._sum.amount ?? 0n);
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
