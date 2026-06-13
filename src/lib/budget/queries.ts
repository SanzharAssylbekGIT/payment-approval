import { prisma } from "@/lib/db";

// План-факт по бюджету 6890 (CLAUDE.md §9). План — из BudgetLine, факт — из
// фактически оплаченных заявок (статус PAID) по соответствующему виду расхода.
// Дивиденды Алмаса — вне бюджета 6890 (исключаем).
export async function getBudget6890(entityId: string, year: number) {
  const period = await prisma.budgetPeriod.findFirst({
    where: { entityId, year, month: null },
    include: { lines: { include: { expenseType: true } } },
  });

  // Факт: суммы оплаченных заявок, сгруппированные по виду расхода (только 6890).
  const paid = await prisma.paymentRequest.findMany({
    where: { entityId, status: "PAID", expenseType: { accountKind: "MAIN", code: { not: "DIVIDENDS" } } },
    select: { amount: true, expenseTypeId: true },
  });
  const factByType = new Map<string, bigint>();
  for (const p of paid) factByType.set(p.expenseTypeId, (factByType.get(p.expenseTypeId) ?? 0n) + p.amount);

  const lines = (period?.lines ?? []).map((l) => {
    const planned = l.plannedAmount;
    const actual = l.expenseTypeId ? factByType.get(l.expenseTypeId) ?? 0n : 0n;
    const deviation = planned - actual;
    const pct = planned > 0n ? Number((actual * 100n) / planned) : 0;
    return { id: l.id, title: l.title, planned, actual, deviation, pct };
  });

  const totalPlan = lines.reduce((s, l) => s + l.planned, 0n);
  const totalFact = lines.reduce((s, l) => s + l.actual, 0n);

  return { year, hasPeriod: !!period, lines, totalPlan, totalFact, totalDeviation: totalPlan - totalFact, totalPct: totalPlan > 0n ? Number((totalFact * 100n) / totalPlan) : 0 };
}
