import { prisma } from "@/lib/db";

// План-факт по бюджету 6890 (CLAUDE.md §9). План — из BudgetLine. Факт — из
// ПРОВЕДЁННЫХ выплат (Transaction kind=PAYOUT на счёте 6890) ЗА ПЕРИОД бюджета,
// по виду расхода заявки. Дата факта = occurredAt (реальная дата списания),
// а не дата заявки. Дивиденды Алмаса — вне бюджета (нет строки — нет факта).
export async function getBudget6890(entityId: string, year: number, month: number | null = null) {
  const period = await prisma.budgetPeriod.findFirst({
    where: { entityId, year, month },
    include: { lines: { include: { expenseType: true } } },
  });

  // Окно периода: конкретный месяц или весь год (month = null).
  const from = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1);
  const to = month ? new Date(year, month, 1) : new Date(year + 1, 0, 1);

  const payouts = await prisma.transaction.findMany({
    where: {
      entityId,
      kind: "PAYOUT",
      occurredAt: { gte: from, lt: to },
      account: { kind: "MAIN" },
      paymentRequestId: { not: null },
    },
    select: { amount: true, paymentRequest: { select: { expenseTypeId: true, budgetLineId: true } } },
  });
  // Факт по СТАТЬЕ (заявка привязана к строке бюджета, §22) — основной путь;
  // по виду расхода — фолбэк для старых строк без прямых заявок.
  const factByLine = new Map<string, bigint>();
  const factByType = new Map<string, bigint>();
  for (const p of payouts) {
    // Выплаты в журнале отрицательны — факт расходов берём по модулю.
    const bl = p.paymentRequest?.budgetLineId;
    if (bl) factByLine.set(bl, (factByLine.get(bl) ?? 0n) + -p.amount);
    const et = p.paymentRequest?.expenseTypeId;
    if (et) factByType.set(et, (factByType.get(et) ?? 0n) + -p.amount);
  }

  const lines = (period?.lines ?? [])
    .map((l) => {
      const planned = l.plannedAmount;
      // Приоритет факта: сверенный по выписке actualAmount → выплаты по заявкам
      // этой статьи (budgetLineId) → выплаты по виду расхода (старые строки).
      const direct = factByLine.get(l.id) ?? 0n;
      const actual =
        l.actualAmount > 0n ? l.actualAmount : direct > 0n ? direct : l.expenseTypeId ? (factByType.get(l.expenseTypeId) ?? 0n) : 0n;
      const deviation = planned - actual;
      const pct = planned > 0n ? Number((actual * 100n) / planned) : 0;
      return { id: l.id, title: l.title, planned, actual, deviation, pct };
    })
    .sort((a, b) => Number(b.planned - a.planned)); // крупные статьи сверху

  const totalPlan = lines.reduce((s, l) => s + l.planned, 0n);
  const totalFact = lines.reduce((s, l) => s + l.actual, 0n);

  return { year, month, hasPeriod: !!period, lines, totalPlan, totalFact, totalDeviation: totalPlan - totalFact, totalPct: totalPlan > 0n ? Number((totalFact * 100n) / totalPlan) : 0 };
}

// Список периодов, по которым заведён бюджет (для переключателя на странице).
export async function getBudgetPeriods(entityId: string) {
  return prisma.budgetPeriod.findMany({
    where: { entityId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { year: true, month: true },
  });
}
