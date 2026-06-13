// Бизнес-логика жизненного цикла заявки — БЕЗ привязки к транспорту (cookies/
// redirect/revalidate). Принимает явного пользователя. Это делает логику
// тестируемой напрямую и отделяет её от слоя Server Actions (actions.ts —
// тонкие обёртки: requireUser + вызов сервиса + revalidate/redirect).

import { prisma } from "@/lib/db";
import { canSeeEverything } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { Priority } from "@prisma/client";

// Доменная ошибка с человекочитаемым сообщением (показывается в форме).
export class RequestError extends Error {}

export interface CreateRequestInput {
  expenseTypeId: string;
  projectId?: string;
  recipientId?: string;
  estimateLineId?: string;
  amountTiyn: bigint;
  purpose: string;
  priority: Priority;
  desiredPayDate?: Date | null;
  comment?: string | null;
}

async function nextRequestNumber(entityId: string): Promise<string> {
  const count = await prisma.paymentRequest.count({ where: { entityId } });
  return `REQ-${String(count + 1).padStart(4, "0")}`;
}

// Создание заявки (Черновик) с проверкой прав и проектной целостности.
export async function createRequestForUser(user: AuthenticatedUser, input: CreateRequestInput) {
  if (input.amountTiyn <= 0n) throw new RequestError("Сумма должна быть больше нуля");

  const expenseType = await prisma.expenseType.findFirst({
    where: { id: input.expenseTypeId, entityId: user.entityId, isActive: true },
  });
  if (!expenseType) throw new RequestError("Вид расхода не найден");

  // Право создавать: свой департамент (или «видит всё»).
  if (!canSeeEverything(user) && expenseType.departmentId !== user.departmentId) {
    throw new RequestError("Нет прав создавать заявки этого вида");
  }

  if (expenseType.isProjectCost) {
    if (!input.projectId) throw new RequestError("Для этого вида расхода нужен проект");
    const project = await prisma.project.findFirst({ where: { id: input.projectId, entityId: user.entityId } });
    if (!project) throw new RequestError("Проект не найден");
    if (input.recipientId) {
      const rec = await prisma.recipient.findFirst({ where: { id: input.recipientId, projectId: project.id } });
      if (!rec) throw new RequestError("Получатель не относится к проекту");
    }
    if (input.estimateLineId) {
      const line = await prisma.estimateLine.findFirst({
        where: { id: input.estimateLineId, version: { estimate: { projectId: project.id } } },
      });
      if (!line) throw new RequestError("Строка сметы не относится к проекту");
    }
  }

  const number = await nextRequestNumber(user.entityId);
  const created = await prisma.paymentRequest.create({
    data: {
      entityId: user.entityId,
      number,
      expenseTypeId: expenseType.id,
      status: "DRAFT",
      createdById: user.id,
      projectId: expenseType.isProjectCost ? input.projectId : null,
      recipientId: expenseType.isProjectCost ? input.recipientId ?? null : null,
      estimateLineId: expenseType.isProjectCost ? input.estimateLineId ?? null : null,
      amount: input.amountTiyn,
      purpose: input.purpose,
      priority: input.priority,
      desiredPayDate: input.desiredPayDate ?? null,
      comment: input.comment ?? null,
    },
  });

  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_CREATED", targetType: "PaymentRequest", targetId: created.id, comment: `Создана заявка ${number}` });
  return created;
}

function loadWithRoute(id: string, entityId: string) {
  return prisma.paymentRequest.findFirst({
    where: { id, entityId },
    include: { expenseType: { include: { route: { include: { steps: { orderBy: { order: "asc" } } } } } } },
  });
}
type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadWithRoute>>>;

function currentStep(req: LoadedRequest) {
  return req.expenseType.route?.steps.find((s) => s.order === req.currentStepOrder) ?? null;
}

// Отправка черновика на согласование: к первой ступени маршрута.
export async function submitRequestForUser(user: AuthenticatedUser, id: string) {
  const req = await loadWithRoute(id, user.entityId);
  if (!req) throw new RequestError("Заявка не найдена");
  if (req.createdById !== user.id) throw new RequestError("Только автор может отправить заявку");
  if (req.status !== "DRAFT" && req.status !== "CLARIFICATION") throw new RequestError("Заявку нельзя отправить из текущего статуса");

  const steps = req.expenseType.route?.steps ?? [];
  if (steps.length === 0) {
    await prisma.paymentRequest.update({ where: { id }, data: { status: "APPROVED", currentStepOrder: 0 } });
  } else {
    await prisma.paymentRequest.update({ where: { id }, data: { status: "PENDING_APPROVAL", currentStepOrder: steps[0].order } });
  }
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_SUBMITTED", targetType: "PaymentRequest", targetId: id, comment: "Отправлена на согласование" });
}

// Проверка: пользователь — согласующий на текущей ступени.
function assertCurrentApprover(req: LoadedRequest, userId: string): boolean {
  if (req.status !== "PENDING_APPROVAL") return false;
  return currentStep(req)?.approverId === userId;
}

// Одобрение текущей ступени → следующая ступень или статус «Одобрена».
export async function approveStepForUser(user: AuthenticatedUser, id: string, comment?: string) {
  const req = await loadWithRoute(id, user.entityId);
  if (!req) throw new RequestError("Заявка не найдена");
  if (!assertCurrentApprover(req, user.id)) throw new RequestError("Вы не согласующий на текущей ступени");

  const step = currentStep(req)!;
  const steps = req.expenseType.route!.steps;
  const isLast = step.order >= Math.max(...steps.map((s) => s.order));

  await prisma.requestApproval.create({ data: { requestId: id, stepId: step.id, approverId: user.id, decision: "APPROVED", comment: comment || null } });

  if (isLast) {
    await prisma.paymentRequest.update({ where: { id }, data: { status: "APPROVED" } });
    await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_FULLY_APPROVED", targetType: "PaymentRequest", targetId: id, comment: comment || "Заявка одобрена" });
  } else {
    const next = steps.find((s) => s.order > step.order)!;
    await prisma.paymentRequest.update({ where: { id }, data: { currentStepOrder: next.order } });
    await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_STEP_APPROVED", targetType: "PaymentRequest", targetId: id, comment: comment || `Одобрено на ступени ${step.order}` });
  }
}

// Отклонение — останавливает заявку на любой ступени.
export async function rejectStepForUser(user: AuthenticatedUser, id: string, comment: string) {
  const req = await loadWithRoute(id, user.entityId);
  if (!req) throw new RequestError("Заявка не найдена");
  if (!assertCurrentApprover(req, user.id)) throw new RequestError("Вы не согласующий на текущей ступени");
  const step = currentStep(req)!;

  await prisma.requestApproval.create({ data: { requestId: id, stepId: step.id, approverId: user.id, decision: "REJECTED", comment: comment || null } });
  await prisma.paymentRequest.update({ where: { id }, data: { status: "REJECTED" } });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_REJECTED", targetType: "PaymentRequest", targetId: id, comment: comment || "Отклонена" });
}

// Запрос уточнения — возвращает заявку автору.
export async function requestClarificationForUser(user: AuthenticatedUser, id: string, comment: string) {
  const req = await loadWithRoute(id, user.entityId);
  if (!req) throw new RequestError("Заявка не найдена");
  if (!assertCurrentApprover(req, user.id)) throw new RequestError("Вы не согласующий на текущей ступени");
  const step = currentStep(req)!;

  await prisma.requestApproval.create({ data: { requestId: id, stepId: step.id, approverId: user.id, decision: "CLARIFICATION_REQUESTED", comment: comment || null } });
  await prisma.paymentRequest.update({ where: { id }, data: { status: "CLARIFICATION" } });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_CLARIFICATION", targetType: "PaymentRequest", targetId: id, comment: comment || "Запрошено уточнение" });
}

// Отмена автором (пока не одобрена/не оплачена).
export async function cancelRequestForUser(user: AuthenticatedUser, id: string) {
  const req = await prisma.paymentRequest.findFirst({ where: { id, entityId: user.entityId } });
  if (!req) throw new RequestError("Заявка не найдена");
  if (req.createdById !== user.id) throw new RequestError("Только автор может отменить заявку");
  if (["APPROVED", "IN_REGISTER", "PAID", "CANCELLED"].includes(req.status)) throw new RequestError("Заявку нельзя отменить из текущего статуса");

  await prisma.paymentRequest.update({ where: { id }, data: { status: "CANCELLED" } });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_CANCELLED", targetType: "PaymentRequest", targetId: id, comment: "Отменена автором" });
}
