import { prisma } from "@/lib/db";
import { canSeeEverything } from "@/lib/auth/rbac";
import type { AuthenticatedUser } from "@/lib/auth/types";

// Данные для формы создания заявки: доступные виды расходов и проекты с
// получателями/строками сметы. Конфиденциальность: виды расходов — своего
// департамента; проекты — свои/своего блока (или все, если «видит всё»).
export async function getRequestFormData(user: AuthenticatedUser) {
  const seeAll = canSeeEverything(user);

  const expenseTypes = await prisma.expenseType.findMany({
    where: {
      entityId: user.entityId,
      isActive: true,
      ...(seeAll ? {} : { departmentId: user.departmentId ?? "__none__" }),
    },
    orderBy: { name: "asc" },
  });

  const projects = await prisma.project.findMany({
    where: {
      entityId: user.entityId,
      status: "ACTIVE",
      ...(seeAll
        ? {}
        : { OR: [{ ownerUserId: user.id }, { departmentId: user.departmentId ?? "__none__" }] }),
    },
    include: {
      client: true,
      recipients: { orderBy: { name: "asc" } },
      estimate: { include: { currentVersion: { include: { lines: true } } } },
    },
    orderBy: { name: "asc" },
  });

  // BigInt не сериализуется в JSON — отдаём строками для клиентского компонента.
  const projectsForClient = projects.map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client?.name ?? null,
    serviceType: p.serviceType,
    recipients: p.recipients.map((r) => ({ id: r.id, name: r.name })),
    estimateLines: (p.estimate?.currentVersion?.lines ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      plannedAmount: l.plannedAmount.toString(),
      recipientId: l.recipientId,
    })),
  }));

  return {
    expenseTypes: expenseTypes.map((e) => ({
      id: e.id,
      name: e.name,
      isProjectCost: e.isProjectCost,
      requiresEstimate: e.requiresEstimate,
      defaultPriority: e.defaultPriority,
    })),
    projects: projectsForClient,
  };
}

// Заявки, созданные пользователем (заявитель видит только свои — CLAUDE.md §10).
export async function getMyRequests(user: AuthenticatedUser) {
  return prisma.paymentRequest.findMany({
    where: { entityId: user.entityId, createdById: user.id },
    include: { expenseType: true, project: { include: { client: true } }, recipient: true },
    orderBy: { createdAt: "desc" },
  });
}

// Очередь согласования «на мне»: заявки на текущей ступени, где согласующий — я.
export async function getApprovalQueue(user: AuthenticatedUser) {
  const pending = await prisma.paymentRequest.findMany({
    where: {
      entityId: user.entityId,
      status: "PENDING_APPROVAL",
      expenseType: { route: { steps: { some: { approverId: user.id } } } },
    },
    include: {
      expenseType: { include: { route: { include: { steps: true } } } },
      project: { include: { client: true } },
      recipient: true,
      createdBy: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Оставляем только те, где МОЯ ступень — текущая.
  return pending.filter((r) => {
    const step = r.expenseType.route?.steps.find((s) => s.order === r.currentStepOrder);
    return step?.approverId === user.id;
  });
}

// Одна заявка с проверкой доступа: создатель, согласующий на маршруте, или
// тот, кто «видит всё». Иначе null.
export async function getRequestForUser(user: AuthenticatedUser, id: string) {
  const req = await prisma.paymentRequest.findFirst({
    where: { id, entityId: user.entityId },
    include: {
      expenseType: { include: { route: { include: { steps: { include: { approver: true }, orderBy: { order: "asc" } } } } } },
      project: { include: { client: true } },
      recipient: true,
      estimateLine: true,
      createdBy: true,
      attachments: true,
      approvals: { include: { approver: true, step: true }, orderBy: { decidedAt: "asc" } },
    },
  });
  if (!req) return null;

  const isOwner = req.createdById === user.id;
  const isApprover = req.expenseType.route?.steps.some((s) => s.approverId === user.id) ?? false;
  if (!isOwner && !isApprover && !canSeeEverything(user)) return null;

  return req;
}

// Аудит-таймлайн заявки.
export async function getRequestAudit(entityId: string, requestId: string) {
  return prisma.auditLog.findMany({
    where: { entityId, targetType: "PaymentRequest", targetId: requestId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
}
