// Бизнес-логика жизненного цикла заявки — БЕЗ привязки к транспорту (cookies/
// redirect/revalidate). Принимает явного пользователя. Это делает логику
// тестируемой напрямую и отделяет её от слоя Server Actions (actions.ts —
// тонкие обёртки: requireUser + вызов сервиса + revalidate/redirect).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canSeeEverything } from "@/lib/auth/permissions";
import { projectScopeFilter } from "@/lib/projects/scope";
import { writeAudit } from "@/lib/audit";
import { DELIVERABLE_LABELS, BLOGGER_FEE_CODE } from "./status";
import { minPayDateForUrgency } from "./urgency";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { Urgency, PaymentTiming, BloggerDeliverable, ExpenseType } from "@prisma/client";

// Код «Гонорары блогеров» живёт в status.ts (общий для сервера и клиента).
export { BLOGGER_FEE_CODE };

export function isBloggerFee(expenseType: { code: string }): boolean {
  return expenseType.code === BLOGGER_FEE_CODE;
}

// Доменная ошибка с человекочитаемым сообщением (показывается в форме).
export class RequestError extends Error {}

export interface RequestInput {
  expenseTypeId: string;
  projectId?: string;
  recipientId?: string;
  estimateLineId?: string;
  // Продакшн и прочие проектные (не блогер): одна заявка может закрывать
  // НЕСКОЛЬКО позиций сметы разом (мультивыбор).
  estimateLineIds?: string[];
  // Обычная заявка — сумма напрямую.
  amountTiyn?: bigint;
  // Форма блогера — сумма к оплате считается из договора и %.
  contractAmountTiyn?: bigint;
  paymentPercent?: number; // 0..100
  paymentTiming?: PaymentTiming;
  serviceRendered?: boolean;
  deliverables?: BloggerDeliverable[];
  purpose?: string | null;
  urgency: Urgency;
  desiredPayDate?: Date | null;
  comment?: string | null;
  // Статья бюджета 6890 (обязательна для MAIN-видов, кроме ФОТ/дивидендов).
  budgetLineId?: string | null;
}

// Итог расчёта полей заявки: сумма к оплате + назначение + нормализованные
// поля блогера (для не-блогерских видов расхода они null/пустые).
interface ResolvedFields {
  amount: bigint;
  purpose: string | null;
  contractAmount: bigint | null;
  paymentPercent: number | null;
  paymentTiming: PaymentTiming | null;
  serviceRendered: boolean;
  deliverables: BloggerDeliverable[];
}

// Сумма к оплате для блогера = договор × % (округление до тиына, half-up).
function computeBloggerAmount(contractTiyn: bigint, pct: number): bigint {
  return (contractTiyn * BigInt(pct) + 50n) / 100n;
}

// Расчёт и валидация суммы/назначения в зависимости от вида расхода.
// optionText — утверждённая опция из сметы проекта (для гонорара блогера).
function resolveFields(expenseType: ExpenseType, input: RequestInput, optionText?: string | null): ResolvedFields {
  if (isBloggerFee(expenseType)) {
    const contract = input.contractAmountTiyn ?? 0n;
    const pct = input.paymentPercent ?? 0;
    if (contract <= 0n) throw new RequestError("Укажите сумму по договору с блогером");
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) throw new RequestError("% от оплаты должен быть от 1 до 100");
    const amount = computeBloggerAmount(contract, pct);
    if (amount <= 0n) throw new RequestError("Сумма к оплате получилась нулевой — проверьте договор и %");

    const deliverables = input.deliverables ?? [];
    const deliverableText = optionText ?? deliverables.map((d) => DELIVERABLE_LABELS[d]).join(", ");
    const purpose = deliverableText ? `Гонорар блогеру: ${deliverableText}` : "Гонорар блогеру";

    return {
      amount,
      purpose,
      contractAmount: contract,
      paymentPercent: pct,
      paymentTiming: input.paymentTiming ?? null,
      serviceRendered: input.serviceRendered ?? false,
      deliverables,
    };
  }

  // Обычная заявка. Для проектных видов (продакшн и др.) возможна частичная
  // оплата: % от суммы позиций (типовые 50/50) + предоплата/постоплата.
  const amount = input.amountTiyn ?? 0n;
  if (amount <= 0n) throw new RequestError("Сумма должна быть больше нуля");
  const purpose = (input.purpose ?? "").trim();
  if (!purpose) throw new RequestError("Укажите назначение платежа");

  let pct: number | null = null;
  if (expenseType.isProjectCost && input.paymentPercent != null) {
    if (!Number.isInteger(input.paymentPercent) || input.paymentPercent < 1 || input.paymentPercent > 100) {
      throw new RequestError("% от суммы должен быть от 1 до 100");
    }
    pct = input.paymentPercent;
  }

  return {
    amount,
    purpose,
    contractAmount: null,
    paymentPercent: pct,
    paymentTiming: expenseType.isProjectCost ? input.paymentTiming ?? null : null,
    serviceRendered: false,
    deliverables: [],
  };
}

// Желаемая дата не может быть раньше минимума по срочности (в т.ч. не в прошлом).
// Блогеры: плановые выплаты проводятся раз в неделю по ЧЕТВЕРГАМ; «Срочно»
// (1 раб. день) — единственный способ выплатить вне четверга.
function validateDesiredDate(expenseType: ExpenseType, urgency: Urgency, date: Date | null | undefined) {
  if (!date) return;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (isBloggerFee(expenseType) && urgency !== "URGENT") {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d < today) throw new RequestError("Желаемая дата оплаты в прошлом");
    if (d.getDay() !== 4) {
      throw new RequestError("Плановые выплаты блогерам проводятся по четвергам — выберите четверг или срочность «Срочно»");
    }
    return;
  }
  const min = minPayDateForUrgency(urgency);
  if (d < min) {
    throw new RequestError("Желаемая дата оплаты раньше, чем допускает выбранная срочность");
  }
}

// Гонорар блогера: заявка привязывается к УТВЕРЖДЁННОЙ опции из сметы проекта
// (строка блогер × опция). Подставляет получателя и форматы из строки.
async function applyBloggerLine(expenseType: ExpenseType, input: RequestInput) {
  if (!isBloggerFee(expenseType) || !input.estimateLineId) return null;
  if (!input.projectId) throw new RequestError("Для выбора опции нужен проект");
  const line = await prisma.estimateLine.findFirst({
    where: { id: input.estimateLineId, kind: "RECIPIENT", version: { estimate: { projectId: input.projectId } } },
  });
  if (!line) throw new RequestError("Утверждённая опция не найдена в смете проекта");
  if (input.recipientId && line.recipientId && input.recipientId !== line.recipientId) {
    throw new RequestError("Выбранная опция относится к другому блогеру");
  }
  if (line.recipientId) input.recipientId = line.recipientId;
  if (!(input.deliverables?.length) && line.deliverables.length) input.deliverables = line.deliverables;
  return line;
}

// Проверка прав + проектной целостности (общая для create/update).
async function assertAccessAndProject(user: AuthenticatedUser, expenseType: ExpenseType, input: RequestInput) {
  // Право создавать: свой департамент (или «видит всё»). null-департамент не
  // должен совпадать с null у вида расхода — иначе брешь в правах.
  if (!canSeeEverything(user) && (!user.departmentId || expenseType.departmentId !== user.departmentId)) {
    throw new RequestError("Нет прав создавать заявки этого вида");
  }
  if (!expenseType.isProjectCost) return;

  if (!input.projectId) throw new RequestError("Для этого вида расхода нужен проект");
  // Конфиденциальность (§10): проект — в области видимости пользователя ЛИБО
  // соответствует направлению разрешённого ему вида расхода (право на вид
  // расхода уже проверено выше по департаменту). Зеркало getRequestFormData.
  const scope = projectScopeFilter(user);
  const scopeOr = Array.isArray(scope.OR) ? scope.OR : scope.OR ? [scope.OR] : [];
  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      entityId: user.entityId,
      ...(canSeeEverything(user)
        ? {}
        : { OR: [...scopeOr, ...(expenseType.serviceType ? [{ serviceType: expenseType.serviceType }] : [])] }),
    },
  });
  if (!project) throw new RequestError("Проект не найден");
  // Проект должен соответствовать услуге вида расхода.
  if (expenseType.serviceType && project.serviceType !== expenseType.serviceType) {
    throw new RequestError("Проект не соответствует виду услуги");
  }
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
  const lineIds = uniqueLineIds(input);
  if (lineIds.length > 0) {
    const count = await prisma.estimateLine.count({
      where: { id: { in: lineIds }, kind: "RECIPIENT", version: { estimate: { projectId: project.id } } },
    });
    if (count !== lineIds.length) throw new RequestError("Некоторые позиции сметы не относятся к проекту");
  }
}

function uniqueLineIds(input: RequestInput): string[] {
  return [...new Set((input.estimateLineIds ?? []).filter(Boolean))];
}

// Дробление платежей продакшна: суммарный % по КАЖДОЙ позиции сметы (по всем
// «живым» заявкам, привязанным к ней) не должен превышать 100 — например,
// 50% предоплата + 50% постоплата, третья заявка не пройдёт.
async function assertLinePercentLimit(
  user: AuthenticatedUser,
  expenseType: ExpenseType,
  input: RequestInput,
  pct: number | null,
  excludeRequestId?: string,
) {
  if (isBloggerFee(expenseType) || pct == null) return;
  const ids = uniqueLineIds(input);
  if (ids.length === 0) return;

  const links = await prisma.paymentRequestLine.findMany({
    where: {
      estimateLineId: { in: ids },
      request: {
        entityId: user.entityId,
        status: { notIn: ["REJECTED", "CANCELLED"] },
        paymentPercent: { not: null },
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
    },
    include: {
      request: { select: { paymentPercent: true } },
      estimateLine: { select: { title: true } },
    },
  });

  const claimed = new Map<string, { sum: number; title: string }>();
  for (const l of links) {
    const cur = claimed.get(l.estimateLineId) ?? { sum: 0, title: l.estimateLine.title };
    cur.sum += l.request.paymentPercent ?? 0;
    claimed.set(l.estimateLineId, cur);
  }
  for (const id of ids) {
    const cur = claimed.get(id);
    if (cur && cur.sum + pct > 100) {
      throw new RequestError(
        `Позиция «${cur.title}»: суммарный % превысит 100 — уже заявлено ${cur.sum}%, добавляется ${pct}%`,
      );
    }
  }
}

// Синхронизирует связь «заявка ↔ позиции сметы» (мультивыбор продакшна).
async function syncRequestLines(requestId: string, input: RequestInput) {
  const ids = uniqueLineIds(input);
  await prisma.paymentRequestLine.deleteMany({ where: { requestId } });
  if (ids.length > 0) {
    await prisma.paymentRequestLine.createMany({ data: ids.map((estimateLineId) => ({ requestId, estimateLineId })) });
  }
}

// Следующий номер = max(существующих)+1, а не count+1: count ломается при
// удалении строк и в гонке двух создающих (уникальный [entityId, number]).
async function nextRequestNumber(entityId: string): Promise<string> {
  const rows = await prisma.paymentRequest.findMany({ where: { entityId }, select: { number: true } });
  let max = 0;
  for (const r of rows) {
    const m = /^REQ-(\d+)$/.exec(r.number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `REQ-${String(max + 1).padStart(4, "0")}`;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// Суммарный % выплат по договору блогера (проект+получатель) не должен
// превышать 100 (DECISIONS §12.3: % — доля от общей суммы по договору).
// Учитываем все «живые» заявки, включая черновики (это заявленные доли).
async function assertBloggerPercentLimit(
  user: AuthenticatedUser,
  expenseType: ExpenseType,
  input: RequestInput,
  pct: number,
  excludeRequestId?: string,
) {
  if (!isBloggerFee(expenseType) || !input.projectId || !input.recipientId) return;
  const prior = await prisma.paymentRequest.aggregate({
    _sum: { paymentPercent: true },
    where: {
      entityId: user.entityId,
      expenseTypeId: expenseType.id,
      projectId: input.projectId,
      recipientId: input.recipientId,
      status: { notIn: ["REJECTED", "CANCELLED"] },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
    },
  });
  const already = prior._sum.paymentPercent ?? 0;
  if (already + pct > 100) {
    throw new RequestError(
      `Суммарный % выплат этому блогеру превысит 100%: уже заявлено ${already}%, добавляется ${pct}%`,
    );
  }
}

// Проектные поля пишем только для проектных видов расхода. У блогера строка
// сметы — это утверждённая опция сделки (блогер × опция). Для остальных
// проектных видов позиции идут мультивыбором (estimateLineIds); одиночное
// поле estimateLineId заполняем, когда позиция ровно одна (план-факт).
function projectData(expenseType: ExpenseType, input: RequestInput) {
  if (!expenseType.isProjectCost) {
    return { projectId: null, recipientId: null, estimateLineId: null };
  }
  const ids = uniqueLineIds(input);
  return {
    projectId: input.projectId ?? null,
    recipientId: input.recipientId ?? null,
    estimateLineId: isBloggerFee(expenseType)
      ? input.estimateLineId ?? null
      : ids.length === 1
        ? ids[0]
        : input.estimateLineId ?? null,
  };
}

// Создание заявки (Черновик) с проверкой прав и проектной целостности.
// Бюджет 6890 (DECISIONS §22): непроектные виды со счётом MAIN подаются на
// конкретную статью бюджета — факт считается по каждой статье. Исключения:
// ФОТ и дивиденды — вне помесячного бюджета бэк-офиса.
const BUDGET_EXEMPT_CODES = new Set(["SALARY", "DIVIDENDS"]);

async function resolveBudgetLine(user: AuthenticatedUser, expenseType: ExpenseType, input: RequestInput): Promise<string | null> {
  const needsLine = expenseType.accountKind === "MAIN" && !expenseType.isProjectCost && !BUDGET_EXEMPT_CODES.has(expenseType.code);
  if (!needsLine) return null;
  if (!input.budgetLineId) throw new RequestError("Выберите статью бюджета");
  const line = await prisma.budgetLine.findFirst({
    where: { id: input.budgetLineId, period: { entityId: user.entityId } },
  });
  if (!line) throw new RequestError("Статья бюджета не найдена");
  return line.id;
}

export async function createRequestForUser(user: AuthenticatedUser, input: RequestInput) {
  const expenseType = await prisma.expenseType.findFirst({
    where: { id: input.expenseTypeId, entityId: user.entityId, isActive: true },
  });
  if (!expenseType) throw new RequestError("Вид расхода не найден");

  const line = await applyBloggerLine(expenseType, input);
  await assertAccessAndProject(user, expenseType, input);
  const fields = resolveFields(expenseType, input, line?.customDeliverable ?? null);
  validateDesiredDate(expenseType, input.urgency, input.desiredPayDate);
  if (fields.paymentPercent != null) {
    await assertBloggerPercentLimit(user, expenseType, input, fields.paymentPercent);
    await assertLinePercentLimit(user, expenseType, input, fields.paymentPercent);
  }
  const budgetLineId = await resolveBudgetLine(user, expenseType, input);

  const data = {
    entityId: user.entityId,
    expenseTypeId: expenseType.id,
    status: "DRAFT" as const,
    createdById: user.id,
    ...projectData(expenseType, input),
    budgetLineId,
    amount: fields.amount,
    purpose: fields.purpose,
    urgency: input.urgency,
    desiredPayDate: input.desiredPayDate ?? null,
    comment: input.comment ?? null,
    contractAmount: fields.contractAmount,
    paymentPercent: fields.paymentPercent,
    paymentTiming: fields.paymentTiming,
    serviceRendered: fields.serviceRendered,
    deliverables: fields.deliverables,
  };

  // Ретрай на гонке номеров: два одновременных создания получают одинаковый
  // max+1 → уникальный [entityId, number] бросит P2002 → пересчитываем.
  let created;
  for (let attempt = 0; ; attempt++) {
    const number = await nextRequestNumber(user.entityId);
    try {
      created = await prisma.paymentRequest.create({ data: { ...data, number } });
      break;
    } catch (e) {
      if (attempt < 3 && isUniqueViolation(e)) continue;
      throw e;
    }
  }

  if (!isBloggerFee(expenseType)) await syncRequestLines(created.id, input);

  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_CREATED", targetType: "PaymentRequest", targetId: created.id, comment: `Создана заявка ${created.number}` });
  return created;
}

// Редактирование заявки автором (только Черновик или На доработке).
export async function updateRequestForUser(user: AuthenticatedUser, id: string, input: RequestInput) {
  const existing = await prisma.paymentRequest.findFirst({ where: { id, entityId: user.entityId } });
  if (!existing) throw new RequestError("Заявка не найдена");
  if (existing.createdById !== user.id) throw new RequestError("Редактировать может только автор");
  if (existing.status !== "DRAFT" && existing.status !== "CLARIFICATION") {
    throw new RequestError("Заявку нельзя редактировать из текущего статуса");
  }

  const expenseType = await prisma.expenseType.findFirst({
    where: { id: input.expenseTypeId, entityId: user.entityId, isActive: true },
  });
  if (!expenseType) throw new RequestError("Вид расхода не найден");

  const line = await applyBloggerLine(expenseType, input);
  await assertAccessAndProject(user, expenseType, input);
  const fields = resolveFields(expenseType, input, line?.customDeliverable ?? null);
  validateDesiredDate(expenseType, input.urgency, input.desiredPayDate);
  if (fields.paymentPercent != null) {
    await assertBloggerPercentLimit(user, expenseType, input, fields.paymentPercent, id);
    await assertLinePercentLimit(user, expenseType, input, fields.paymentPercent, id);
  }
  const budgetLineId = await resolveBudgetLine(user, expenseType, input);

  const updated = await prisma.paymentRequest.update({
    where: { id },
    data: {
      expenseTypeId: expenseType.id,
      ...projectData(expenseType, input),
      budgetLineId,
      amount: fields.amount,
      purpose: fields.purpose,
      urgency: input.urgency,
      desiredPayDate: input.desiredPayDate ?? null,
      comment: input.comment ?? null,
      contractAmount: fields.contractAmount,
      paymentPercent: fields.paymentPercent,
      paymentTiming: fields.paymentTiming,
      serviceRendered: fields.serviceRendered,
      deliverables: fields.deliverables,
    },
  });

  await syncRequestLines(id, isBloggerFee(expenseType) ? { ...input, estimateLineIds: [] } : input);

  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_UPDATED", targetType: "PaymentRequest", targetId: id, comment: "Заявка отредактирована" });
  return updated;
}

function loadWithRoute(id: string, entityId: string) {
  return prisma.paymentRequest.findFirst({
    where: { id, entityId },
    include: {
      expenseType: { include: { route: { include: { steps: { orderBy: { order: "asc" } } } } } },
      attachments: true,
    },
  });
}
type LoadedRequest = NonNullable<Awaited<ReturnType<typeof loadWithRoute>>>;

function currentStep(req: LoadedRequest) {
  return req.expenseType.route?.steps.find((s) => s.order === req.currentStepOrder) ?? null;
}

// Отправка черновика/доработки на согласование: к первой ступени маршрута.
export async function submitRequestForUser(user: AuthenticatedUser, id: string) {
  const req = await loadWithRoute(id, user.entityId);
  if (!req) throw new RequestError("Заявка не найдена");
  if (req.createdById !== user.id) throw new RequestError("Только автор может отправить заявку");
  if (req.status !== "DRAFT" && req.status !== "CLARIFICATION") throw new RequestError("Заявку нельзя отправить из текущего статуса");

  // Услуга оказана → обязателен подписанный акт выполненных работ.
  if (isBloggerFee(req.expenseType) && req.serviceRendered && !req.attachments.some((a) => a.kind === "ACT")) {
    throw new RequestError("Прикрепите подписанный акт выполненных работ — услуга отмечена как оказанная");
  }

  const steps = req.expenseType.route?.steps ?? [];
  // Claim-guard: переход только из DRAFT/CLARIFICATION (гонка двойной отправки).
  const claimed = await prisma.paymentRequest.updateMany({
    where: { id, status: { in: ["DRAFT", "CLARIFICATION"] } },
    data: steps.length === 0
      ? { status: "APPROVED", currentStepOrder: 0 }
      : { status: "PENDING_APPROVAL", currentStepOrder: steps[0].order },
  });
  if (claimed.count === 0) throw new RequestError("Статус заявки уже изменился");
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
  const next = isLast ? null : steps.find((s) => s.order > step.order)!;

  // Claim текущей ступени + запись решения — атомарно. Guard по статусу И
  // ступени: двойной клик, гонка с отзывом/отклонением — второй проигрывает.
  await prisma.$transaction(async (db) => {
    const claimed = await db.paymentRequest.updateMany({
      where: { id, status: "PENDING_APPROVAL", currentStepOrder: step.order },
      data: isLast ? { status: "APPROVED" } : { currentStepOrder: next!.order },
    });
    if (claimed.count === 0) throw new RequestError("Заявка уже обработана на этой ступени");
    await db.requestApproval.create({ data: { requestId: id, stepId: step.id, approverId: user.id, decision: "APPROVED", comment: comment || null } });
  });

  if (isLast) {
    await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_FULLY_APPROVED", targetType: "PaymentRequest", targetId: id, comment: comment || "Заявка одобрена" });
  } else {
    await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_STEP_APPROVED", targetType: "PaymentRequest", targetId: id, comment: comment || `Одобрено на ступени ${step.order}` });
  }
}

// Отклонение — останавливает заявку на любой ступени.
export async function rejectStepForUser(user: AuthenticatedUser, id: string, comment: string) {
  const req = await loadWithRoute(id, user.entityId);
  if (!req) throw new RequestError("Заявка не найдена");
  if (!assertCurrentApprover(req, user.id)) throw new RequestError("Вы не согласующий на текущей ступени");
  const step = currentStep(req)!;

  await prisma.$transaction(async (db) => {
    const claimed = await db.paymentRequest.updateMany({
      where: { id, status: "PENDING_APPROVAL", currentStepOrder: step.order },
      data: { status: "REJECTED" },
    });
    if (claimed.count === 0) throw new RequestError("Заявка уже обработана на этой ступени");
    await db.requestApproval.create({ data: { requestId: id, stepId: step.id, approverId: user.id, decision: "REJECTED", comment: comment || null } });
  });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_REJECTED", targetType: "PaymentRequest", targetId: id, comment: comment || "Отклонена" });
}

// Запрос уточнения — возвращает заявку автору «на доработку».
export async function requestClarificationForUser(user: AuthenticatedUser, id: string, comment: string) {
  const req = await loadWithRoute(id, user.entityId);
  if (!req) throw new RequestError("Заявка не найдена");
  if (!assertCurrentApprover(req, user.id)) throw new RequestError("Вы не согласующий на текущей ступени");
  const step = currentStep(req)!;

  await prisma.$transaction(async (db) => {
    const claimed = await db.paymentRequest.updateMany({
      where: { id, status: "PENDING_APPROVAL", currentStepOrder: step.order },
      data: { status: "CLARIFICATION", currentStepOrder: 0 },
    });
    if (claimed.count === 0) throw new RequestError("Заявка уже обработана на этой ступени");
    await db.requestApproval.create({ data: { requestId: id, stepId: step.id, approverId: user.id, decision: "CLARIFICATION_REQUESTED", comment: comment || null } });
  });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_CLARIFICATION", targetType: "PaymentRequest", targetId: id, comment: comment || "Возвращена на доработку" });
}

// Отмена автором (пока не одобрена/не оплачена).
export async function cancelRequestForUser(user: AuthenticatedUser, id: string) {
  const req = await prisma.paymentRequest.findFirst({ where: { id, entityId: user.entityId } });
  if (!req) throw new RequestError("Заявка не найдена");
  if (req.createdById !== user.id) throw new RequestError("Только автор может отменить заявку");
  if (["APPROVED", "IN_REGISTER", "PAID", "CANCELLED"].includes(req.status)) throw new RequestError("Заявку нельзя отменить из текущего статуса");

  const claimed = await prisma.paymentRequest.updateMany({
    where: { id, status: { in: ["DRAFT", "PENDING_APPROVAL", "CLARIFICATION", "REJECTED"] } },
    data: { status: "CANCELLED" },
  });
  if (claimed.count === 0) throw new RequestError("Статус заявки уже изменился");
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REQUEST_CANCELLED", targetType: "PaymentRequest", targetId: id, comment: "Отменена автором" });
}
