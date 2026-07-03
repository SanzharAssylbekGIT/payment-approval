import { prisma } from "@/lib/db";
import { accountBalances, projectBalances, ledgerBalance } from "./balances";

// entityId ВСЕГДА передаётся явно (user.entityId) — никаких дефолтов:
// мультиарендность и конфиденциальность на уровне запросов (CLAUDE.md §2, §10).

// Сводка учёта: остатки по счетам + балансы леджеров (проекты/депозиты/резервы).
export async function getAccountingOverview(entityId: string) {
  const accounts = await accountBalances(entityId);
  const ledgers = await prisma.ledger.findMany({ where: { entityId }, orderBy: { kind: "asc" } });
  const ledgerRows = await Promise.all(
    ledgers.map(async (l) => ({ id: l.id, kind: l.kind, name: l.name, balance: await ledgerBalance(l.id) })),
  );
  return { accounts, ledgers: ledgerRows };
}

// Дерево Клиент → Проект → Получатель с балансами на каждом уровне (ядро §6).
// Только леджер 7366 (себестоимость проектов).
export async function getClientProjectTree(entityId: string) {
  const ledger = await prisma.ledger.findFirst({ where: { entityId, kind: "COST_7366" } });
  const projects = await prisma.project.findMany({
    where: { entityId, ledgerId: ledger?.id },
    include: { client: true, recipients: true },
  });
  const balances = await projectBalances(entityId);

  // Группировка по клиенту.
  const byClient = new Map<string, { clientId: string | null; clientName: string; projects: typeof projects; balance: bigint }>();
  for (const p of projects) {
    const key = p.clientId ?? "__none__";
    const name = p.client?.name ?? "Без клиента";
    if (!byClient.has(key)) byClient.set(key, { clientId: p.clientId, clientName: name, projects: [], balance: 0n });
    const group = byClient.get(key)!;
    group.projects.push(p);
    group.balance += balances.get(p.id) ?? 0n;
  }

  const clients = [...byClient.values()].map((g) => ({
    ...g,
    projects: g.projects.map((p) => ({ id: p.id, name: p.name, serviceType: p.serviceType, status: p.status, recipientCount: p.recipients.length, balance: balances.get(p.id) ?? 0n })),
  }));
  const total = [...balances.values()].reduce((s, v) => s + v, 0n);
  return { clients, total };
}

// Детализация проекта: получатели (план из сметы / факт из выплат), баланс, операции.
export async function getProjectDetail(entityId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, entityId },
    include: {
      client: true,
      ledger: true,
      estimate: { include: { currentVersion: { include: { lines: true } } } },
      recipients: true,
      incomings: { orderBy: { receivedAt: "desc" } },
      transactions: { orderBy: { occurredAt: "desc" }, include: { recipient: true, paymentRequest: true } },
    },
  });
  if (!project) return null;

  // План по получателю — из строк сметы; факт — из проведённых выплат (PAYOUT).
  const lines = project.estimate?.currentVersion?.lines ?? [];
  const paidByRecipient = new Map<string, bigint>();
  for (const t of project.transactions) {
    if (t.kind === "PAYOUT" && t.recipientId) {
      paidByRecipient.set(t.recipientId, (paidByRecipient.get(t.recipientId) ?? 0n) + -t.amount);
    }
  }

  const recipients = project.recipients.map((r) => {
    const line = lines.find((l) => l.recipientId === r.id);
    const paid = paidByRecipient.get(r.id) ?? 0n;
    return { id: r.id, name: r.name, planned: line?.plannedAmount ?? 0n, paid, isPaid: paid > 0n };
  });

  const balance = project.transactions.reduce((s, t) => s + t.amount, 0n);
  const paidCount = recipients.filter((r) => r.isPaid).length;

  return { project, recipients, balance, paidCount, toPayCount: recipients.length - paidCount };
}

// Депозиты и резервы: баланс + операции (приток/отток). DECISIONS §3, §7.
export async function getDepositsReserves(entityId: string) {
  const ledgers = await prisma.ledger.findMany({
    where: { entityId, kind: { in: ["DEPOSIT_INFLUENCE", "RESERVE_COMMERCIAL"] } },
  });
  return Promise.all(
    ledgers.map(async (l) => {
      const projects = await prisma.project.findMany({ where: { ledgerId: l.id }, select: { id: true } });
      const balance = await ledgerBalance(l.id);
      const movements = await prisma.transaction.findMany({
        where: { projectId: { in: projects.map((p) => p.id) } },
        orderBy: { occurredAt: "desc" },
        take: 20,
        include: { project: true },
      });
      return { id: l.id, kind: l.kind, name: l.name, balance, movements };
    }),
  );
}

// Поступления от клиентов: список со статусом разнесения.
export async function getIncomings(entityId: string) {
  return prisma.incoming.findMany({
    where: { entityId },
    include: { project: { include: { client: true } }, responsibleUser: true, allocations: true },
    orderBy: { receivedAt: "desc" },
  });
}
