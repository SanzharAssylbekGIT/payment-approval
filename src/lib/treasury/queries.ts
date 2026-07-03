import { prisma } from "@/lib/db";
import { accountBalances, projectBalances } from "@/lib/accounting/balances";
import type { Urgency } from "@prisma/client";

// Порядок при дефиците (CLAUDE.md §8): по убыванию срочности. Срочность заменила
// прежний «приоритет-критичность»; налоги/ЗП имеют срочность URGENT по умолчанию.
export const URGENCY_RANK: Record<Urgency, number> = {
  URGENT: 1,
  MEDIUM: 2,
  NOT_URGENT: 3,
};

// Реестр на оплату: одобренные и помещённые в реестр заявки, отсортированы по
// приоритету. Подсвечивает выплаты по проектам с отрицательным балансом
// (клиент ещё не заплатил — можно притормозить, §8).
export async function getRegisterRows(entityId: string) {
  const requests = await prisma.paymentRequest.findMany({
    where: { entityId, status: { in: ["APPROVED", "IN_REGISTER"] } },
    include: { expenseType: true, project: { include: { client: true } }, recipient: true, createdBy: true },
  });
  const balances = await projectBalances(entityId);

  return requests
    .map((r) => ({
      ...r,
      rank: URGENCY_RANK[r.urgency],
      // отрицательный баланс проекта = выплачиваем, хотя клиент ещё не заплатил
      projectNegative: r.projectId ? (balances.get(r.projectId) ?? 0n) < 0n : false,
    }))
    // Внутри срочности — по желаемой дате; заявки БЕЗ даты в конец (не вперёд).
    .sort((a, b) => a.rank - b.rank || (a.desiredPayDate?.getTime() ?? Infinity) - (b.desiredPayDate?.getTime() ?? Infinity));
}

// Сводка казначейства: остатки на счетах + итоги к оплате.
export async function getTreasuryOverview(entityId: string) {
  const accounts = await accountBalances(entityId);
  const inRegister = await prisma.paymentRequest.aggregate({
    where: { entityId, status: "IN_REGISTER" },
    _sum: { amount: true },
    _count: true,
  });
  const approved = await prisma.paymentRequest.aggregate({
    where: { entityId, status: "APPROVED" },
    _sum: { amount: true },
    _count: true,
  });
  return {
    accounts,
    inRegisterTotal: inRegister._sum.amount ?? 0n,
    inRegisterCount: inRegister._count,
    approvedTotal: approved._sum.amount ?? 0n,
    approvedCount: approved._count,
  };
}

// Платёжный календарь: ожидаемые выплаты по датам vs ожидаемые поступления.
export async function getCalendarData(entityId: string) {
  // Выплаты: одобренные/в реестре, по желаемой дате оплаты.
  const payments = await prisma.paymentRequest.findMany({
    where: { entityId, status: { in: ["APPROVED", "IN_REGISTER"] } },
    include: { expenseType: true, project: { include: { client: true } } },
    orderBy: { desiredPayDate: "asc" },
  });

  // Ожидаемые поступления: по сметам проектов = clientPriceGross − уже поступило.
  const projects = await prisma.project.findMany({
    where: { entityId, status: "ACTIVE" },
    include: { client: true, estimate: { include: { currentVersion: true } }, incomings: true },
  });
  const receivables = projects
    .map((p) => {
      const gross = p.estimate?.currentVersion?.clientPriceGross ?? 0n;
      const received = p.incomings.reduce((s, i) => s + i.amount, 0n);
      return { projectId: p.id, name: p.name, clientName: p.client?.name ?? null, outstanding: gross - received };
    })
    .filter((r) => r.outstanding > 0n);

  return { payments, receivables };
}
