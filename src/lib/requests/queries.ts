import { prisma } from "@/lib/db";
import { canSeeEverything, hasRole } from "@/lib/auth/rbac";
import { projectScopeFilter } from "@/lib/projects/scope";
import { DELIVERABLE_LABELS } from "./status";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { RequestStatus } from "@prisma/client";

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

  // Для ПОДАЧИ ЗАЯВКИ видимость шире вкладки «Проекты»: заявитель видит ещё и
  // проекты направлений, по которым ему разрешены виды расходов (продюсеры
  // Рамзат/Димаш подают по всем VP/Influence-проектам, не будучи их
  // владельцами). Ровно это же правило проверяет сервер в assertAccessAndProject.
  const requestServiceTypes = [
    ...new Set(expenseTypes.filter((e) => e.isProjectCost && e.serviceType).map((e) => e.serviceType!)),
  ];
  const scope = projectScopeFilter(user);
  const scopeOr = Array.isArray(scope.OR) ? scope.OR : scope.OR ? [scope.OR] : [];
  const projects = await prisma.project.findMany({
    where: {
      entityId: user.entityId,
      status: "ACTIVE",
      ...(canSeeEverything(user)
        ? {}
        : { OR: [...scopeOr, ...(requestServiceTypes.length ? [{ serviceType: { in: requestServiceTypes } }] : [])] }),
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
      kind: l.kind,
      title: l.title,
      // Утверждённая опция сделки: текст из прайса/вручную либо стандартные форматы.
      option: l.customDeliverable ?? (l.deliverables.length ? l.deliverables.map((d) => DELIVERABLE_LABELS[d]).join(", ") : null),
      plannedAmount: l.plannedAmount.toString(),
      recipientId: l.recipientId,
    })),
  }));

  return {
    expenseTypes: expenseTypes.map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      isProjectCost: e.isProjectCost,
      requiresEstimate: e.requiresEstimate,
      serviceType: e.serviceType,
      defaultUrgency: e.defaultUrgency,
    })),
    projects: projectsForClient,
  };
}

// Заявки, созданные пользователем (заявитель видит только свои — CLAUDE.md §10).
// Опциональный фильтр по статусу (для вкладок/фильтра списка).
export async function getMyRequests(user: AuthenticatedUser, status?: RequestStatus) {
  return prisma.paymentRequest.findMany({
    where: { entityId: user.entityId, createdById: user.id, ...(status ? { status } : {}) },
    include: { expenseType: true, project: { include: { client: true } }, recipient: true },
    orderBy: { createdAt: "desc" },
  });
}

// Счётчики статусов для фильтра списка «Мои заявки».
export async function getMyRequestStatusCounts(user: AuthenticatedUser) {
  const rows = await prisma.paymentRequest.groupBy({
    by: ["status"],
    where: { entityId: user.entityId, createdById: user.id },
    _count: true,
  });
  const counts: Partial<Record<RequestStatus, number>> = {};
  let total = 0;
  for (const r of rows) {
    counts[r.status] = r._count;
    total += r._count;
  }
  return { counts, total };
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
      estimateLines: { include: { estimateLine: true } },
      createdBy: true,
      attachments: true,
      approvals: { include: { approver: true, step: true }, orderBy: { decidedAt: "asc" } },
    },
  });
  if (!req) return null;

  const isOwner = req.createdById === user.id;
  const isApprover = req.expenseType.route?.steps.some((s) => s.approverId === user.id) ?? false;
  // Коллегия (TREASURY_BOARD) решает, что оплачивать, — ей нужен доступ к любой
  // заявке из реестра/календаря (иначе 404 по ссылкам из казначейства).
  const isBoard = hasRole(user, "TREASURY_BOARD");
  if (!isOwner && !isApprover && !isBoard && !canSeeEverything(user)) return null;

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
