import { prisma } from "@/lib/db";

// Ежемесячный/годовой отчёт (CLAUDE.md §9): автоматизация ручного отчёта
// бухгалтерии. Считается из поступлений, разносов (Allocation) и выплат.
export async function getFinancialReport(entityId: string, year: number) {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  // Поступления и их разнос.
  const incomings = await prisma.incoming.findMany({
    where: { entityId, receivedAt: { gte: from, lt: to } },
    include: { allocations: true },
  });
  let turnoverGross = 0n; // оборот с НДС
  let vat = 0n, cost = 0n, margin = 0n;
  for (const inc of incomings) {
    turnoverGross += inc.amount;
    for (const a of inc.allocations) {
      vat += a.vatAmount;
      cost += a.costAmount;
      margin += a.marginAmount;
    }
  }
  const turnoverNet = turnoverGross - vat; // оборот без НДС

  // Выплаты по счетам.
  const payouts = await prisma.transaction.findMany({
    where: { entityId, kind: "PAYOUT", occurredAt: { gte: from, lt: to } },
    include: { account: true },
  });
  let costSpend = 0n; // расходы себестоимости (7366)
  let officeSpend = 0n; // офисные расходы (6890)
  let specSpend = 0n; // спецпроекты (0175)
  for (const p of payouts) {
    const amt = -p.amount; // выплаты отрицательны
    if (p.account.code === "7366") costSpend += amt;
    else if (p.account.code === "6890") officeSpend += amt;
    else if (p.account.code === "0175") specSpend += amt;
  }

  return {
    year,
    incomings: { turnoverGross, turnoverNet, vat, cost, margin },
    expenses: { costSpend, officeSpend, specSpend },
  };
}
