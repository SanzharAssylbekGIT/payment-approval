// Запросы вкладки «Проекты» (аккаунт-менеджеры + CFO/бухгалтерия).
// Конфиденциальность §10: не-«видящие всё» получают только свои проекты
// (владелец или департамент) — фильтр в SQL, не в UI.

import { prisma } from "@/lib/db";
import { canSeeEverything } from "@/lib/auth/permissions";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { ServiceType } from "@prisma/client";

function scopeFilter(user: AuthenticatedUser) {
  return canSeeEverything(user)
    ? {}
    : {
        OR: [
          { ownerUserId: user.id },
          { projectManagerId: user.id },
          { departmentId: user.departmentId ?? "__none__" },
        ],
      };
}

// Список проектов одного вида услуги со статусами оплат, сметой и деньгами
// клиента (поступило/дебиторка). showClosed — включать закрытые/отменённые.
export async function getProjectsByService(user: AuthenticatedUser, serviceType: ServiceType, showClosed = false) {
  const projects = await prisma.project.findMany({
    where: {
      entityId: user.entityId,
      serviceType,
      ...(showClosed ? {} : { status: "ACTIVE" }),
      ...scopeFilter(user),
    },
    include: {
      client: true,
      owner: true,
      recipients: true,
      estimate: { include: { currentVersion: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Поступления от клиента по проектам (одним запросом).
  const incomingSums = await prisma.incoming.groupBy({
    by: ["projectId"],
    where: { entityId: user.entityId, projectId: { in: projects.map((p) => p.id) } },
    _sum: { amount: true },
  });
  const receivedByProject = new Map<string, bigint>(
    incomingSums.filter((g) => g.projectId).map((g) => [g.projectId as string, g._sum.amount ?? 0n]),
  );

  // Фактические выплаты по получателям этих проектов (одним запросом).
  const payouts = await prisma.transaction.groupBy({
    by: ["projectId", "recipientId"],
    where: { entityId: user.entityId, kind: "PAYOUT", projectId: { in: projects.map((p) => p.id) } },
    _sum: { amount: true },
  });
  const paidRecipients = new Map<string, Set<string>>();
  const paidTotal = new Map<string, bigint>();
  for (const t of payouts) {
    if (!t.projectId) continue;
    paidTotal.set(t.projectId, (paidTotal.get(t.projectId) ?? 0n) + -(t._sum.amount ?? 0n));
    if (t.recipientId) {
      if (!paidRecipients.has(t.projectId)) paidRecipients.set(t.projectId, new Set());
      paidRecipients.get(t.projectId)!.add(t.recipientId);
    }
  }

  return projects.map((p) => {
    const v = p.estimate?.currentVersion;
    const gross = v?.clientPriceGross ?? 0n;
    const received = receivedByProject.get(p.id) ?? 0n;
    const receivable = gross > received ? gross - received : 0n;
    return {
      id: p.id,
      number: p.number,
      name: p.name,
      status: p.status,
      clientName: p.client?.name ?? null,
      ownerName: p.owner?.fullName ?? null,
      hasEstimate: !!v,
      clientPriceGross: gross,
      costAmount: v?.costAmount ?? 0n,
      recipientsTotal: p.recipients.length,
      recipientsPaid: paidRecipients.get(p.id)?.size ?? 0,
      paidTotal: paidTotal.get(p.id) ?? 0n,
      receivedTotal: received,
      receivable, // дебиторка: клиент ещё должен
    };
  });
}

// Детализация проекта для владельца/департамента (или «видит всё»):
// смета (текущая + версии), получатели план/факт, заявки с датами, баланс.
export async function getProjectDetailForUser(user: AuthenticatedUser, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, entityId: user.entityId, ...scopeFilter(user) },
    include: {
      client: true,
      owner: true,
      projectManager: true,
      ledger: true,
      recipients: { orderBy: { name: "asc" } },
      estimate: {
        include: {
          currentVersion: { include: { lines: true } },
          versions: { include: { createdBy: true }, orderBy: { version: "desc" } },
        },
      },
      paymentRequests: {
        include: { expenseType: true, recipient: true },
        orderBy: { createdAt: "desc" },
      },
      incomings: { orderBy: { receivedAt: "desc" } },
    },
  });
  if (!project) return null;

  const payouts = await prisma.transaction.findMany({
    where: { entityId: user.entityId, projectId, kind: "PAYOUT" },
    select: { recipientId: true, amount: true },
  });
  const paidByRecipient = new Map<string, bigint>();
  for (const t of payouts) {
    if (t.recipientId) paidByRecipient.set(t.recipientId, (paidByRecipient.get(t.recipientId) ?? 0n) + -t.amount);
  }

  const lines = project.estimate?.currentVersion?.lines ?? [];
  const recipients = project.recipients.map((r) => {
    const line = lines.find((l) => l.recipientId === r.id);
    const paid = paidByRecipient.get(r.id) ?? 0n;
    return { id: r.id, name: r.name, planned: line?.plannedAmount ?? 0n, paid, isPaid: paid > 0n };
  });

  const balanceAgg = await prisma.transaction.aggregate({ where: { projectId }, _sum: { amount: true } });
  const paidTotal = [...paidByRecipient.values()].reduce((s, v) => s + v, 0n);
  const cost = project.estimate?.currentVersion?.costAmount ?? 0n;
  const gross = project.estimate?.currentVersion?.clientPriceGross ?? 0n;
  const receivedTotal = project.incomings.reduce((s, i) => s + i.amount, 0n);

  return {
    project,
    recipients,
    balance: balanceAgg._sum.amount ?? 0n,
    paidCount: recipients.filter((r) => r.isPaid).length,
    paidTotal,
    receivedTotal,
    receivable: gross > receivedTotal ? gross - receivedTotal : 0n, // клиент должен
    // Конфликт DECISIONS §1.1: выплачено больше, чем себестоимость новой сметы.
    overpaid: cost > 0n && paidTotal > cost,
  };
}
