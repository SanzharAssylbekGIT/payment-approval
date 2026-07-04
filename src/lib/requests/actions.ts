"use server";

import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { parseTengeToTiyn } from "@/lib/money";
import type { AttachmentKind, BloggerDeliverable, PaymentTiming, Urgency } from "@prisma/client";
import {
  RequestError,
  isBloggerFee,
  createRequestForUser,
  updateRequestForUser,
  submitRequestForUser,
  approveStepForUser,
  rejectStepForUser,
  requestClarificationForUser,
  cancelRequestForUser,
  type RequestInput,
} from "./service";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// Поля-файлы формы → категория вложения.
const FILE_FIELDS: { field: string; kind: AttachmentKind }[] = [
  { field: "file_contract", kind: "CONTRACT" },
  { field: "file_invoice", kind: "INVOICE" },
  { field: "file_act", kind: "ACT" },
  { field: "file_residency", kind: "RESIDENCY_CERT" },
];

const VALID_DELIVERABLES: readonly BloggerDeliverable[] = [
  "STORY", "STORY_SERIES", "REELS", "VIDEO_POST", "PHOTO_POST", "TIKTOK", "YOUTUBE", "OTHER",
];

function revalidateRequest(id?: string) {
  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/requests/${id}`);
}

async function saveUploadedFile(file: File, kind: AttachmentKind, requestId: string) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const safeName = file.name.replace(/[^\w.\-а-яё ]/gi, "_");
  const stored = `${randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, stored), buffer);
  await prisma.attachment.create({
    data: { requestId, kind, fileName: file.name, filePath: stored, mimeType: file.type || "application/octet-stream", sizeBytes: buffer.length },
  });
}

async function saveCategorizedFiles(formData: FormData, requestId: string) {
  for (const { field, kind } of FILE_FIELDS) {
    const file = formData.get(field);
    if (file instanceof File && file.size > 0) await saveUploadedFile(file, kind, requestId);
  }
}

function hasFile(formData: FormData, field: string): boolean {
  const f = formData.get(field);
  return f instanceof File && f.size > 0;
}

const formSchema = z.object({
  expenseTypeId: z.string().min(1, "Выберите вид расхода"),
  projectId: z.string().optional(),
  recipientId: z.string().optional(),
  estimateLineId: z.string().optional(),
  amount: z.string().optional(),
  contractAmount: z.string().optional(),
  paymentPercent: z.string().optional(),
  paymentTiming: z.enum(["PREPAY", "POSTPAY"]).optional(),
  purpose: z.string().optional(),
  urgency: z.enum(["URGENT", "MEDIUM", "NOT_URGENT"]),
  desiredPayDate: z.string().optional(),
  comment: z.string().optional(),
});

export type CreateState = { error?: string };

// Парсит YYYY-MM-DD как ЛОКАЛЬНУЮ дату (00:00) и отвергает некорректные/«перекрут»
// значения (напр. 2026-13-40). Согласовано с validateDesiredDate (локальные геттеры).
function parseDateInput(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new RequestError("Некорректная дата");
  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (
    isNaN(dt.getTime()) ||
    dt.getFullYear() !== Number(y) ||
    dt.getMonth() !== Number(mo) - 1 ||
    dt.getDate() !== Number(d)
  ) {
    throw new RequestError("Некорректная дата");
  }
  return dt;
}

// Собирает RequestInput из формы. Бросает RequestError при некорректных суммах.
function buildInput(formData: FormData): { input: RequestInput; serviceRendered: boolean } {
  const parsed = formSchema.safeParse({
    expenseTypeId: formData.get("expenseTypeId"),
    projectId: formData.get("projectId") || undefined,
    recipientId: formData.get("recipientId") || undefined,
    estimateLineId: formData.get("estimateLineId") || undefined,
    amount: formData.get("amount") || undefined,
    contractAmount: formData.get("contractAmount") || undefined,
    paymentPercent: formData.get("paymentPercent") || undefined,
    paymentTiming: formData.get("paymentTiming") || undefined,
    purpose: formData.get("purpose") || undefined,
    urgency: formData.get("urgency"),
    desiredPayDate: formData.get("desiredPayDate") || undefined,
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) throw new RequestError(parsed.error.issues[0]?.message ?? "Проверьте поля формы");
  const d = parsed.data;

  let amountTiyn: bigint | undefined;
  if (d.amount) {
    try { amountTiyn = parseTengeToTiyn(d.amount); } catch { throw new RequestError("Некорректная сумма"); }
  }
  let contractAmountTiyn: bigint | undefined;
  if (d.contractAmount) {
    try { contractAmountTiyn = parseTengeToTiyn(d.contractAmount); } catch { throw new RequestError("Некорректная сумма по договору"); }
  }
  let paymentPercent: number | undefined;
  if (d.paymentPercent) {
    const n = Number(d.paymentPercent);
    if (!Number.isFinite(n)) throw new RequestError("Некорректный процент оплаты");
    paymentPercent = Math.round(n);
  }

  const deliverables = (formData.getAll("deliverables") as string[]).filter((v): v is BloggerDeliverable =>
    VALID_DELIVERABLES.includes(v as BloggerDeliverable),
  );
  const serviceRendered = formData.get("serviceRendered") === "on";

  const input: RequestInput = {
    expenseTypeId: d.expenseTypeId,
    projectId: d.projectId,
    recipientId: d.recipientId,
    estimateLineId: d.estimateLineId,
    amountTiyn,
    contractAmountTiyn,
    paymentPercent,
    paymentTiming: d.paymentTiming as PaymentTiming | undefined,
    serviceRendered,
    deliverables,
    purpose: d.purpose ?? null,
    urgency: d.urgency as Urgency,
    desiredPayDate: d.desiredPayDate ? parseDateInput(d.desiredPayDate) : null,
    comment: d.comment ?? null,
  };
  return { input, serviceRendered };
}

// Проверка «услуга оказана → нужен акт» до создания/отправки (дружелюбная ошибка
// на форме). Каноничная проверка — в submitRequestForUser.
async function actMissingOnSubmit(
  entityId: string,
  expenseTypeId: string,
  serviceRendered: boolean,
  formHasAct: boolean,
  requestId?: string,
): Promise<boolean> {
  if (!serviceRendered) return false;
  const et = await prisma.expenseType.findFirst({ where: { id: expenseTypeId, entityId } });
  if (!et || !isBloggerFee(et)) return false;
  if (formHasAct) return false;
  if (requestId) {
    const existing = await prisma.attachment.findFirst({ where: { requestId, kind: "ACT" } });
    if (existing) return false;
  }
  return true;
}

// Создание заявки: черновик или сразу на согласование (intent).
export async function createRequest(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const user = await requireUser();
  const intent = formData.get("intent") === "submit" ? "submit" : "draft";

  let input: RequestInput;
  let serviceRendered: boolean;
  try {
    ({ input, serviceRendered } = buildInput(formData));
  } catch (e) {
    if (e instanceof RequestError) return { error: e.message };
    throw e;
  }

  if (intent === "submit" && (await actMissingOnSubmit(user.entityId, input.expenseTypeId, serviceRendered, hasFile(formData, "file_act")))) {
    return { error: "Прикрепите подписанный акт выполненных работ — услуга отмечена как оказанная" };
  }

  let createdId: string;
  try {
    const created = await createRequestForUser(user, input);
    createdId = created.id;
  } catch (e) {
    if (e instanceof RequestError) return { error: e.message };
    throw e;
  }

  await saveCategorizedFiles(formData, createdId);

  if (intent === "submit") {
    try { await submitRequestForUser(user, createdId); } catch (e) { if (!(e instanceof RequestError)) throw e; }
  }

  revalidateRequest(createdId);
  redirect(`/requests/${createdId}`);
}

// Редактирование существующей заявки (черновик / на доработке).
export async function updateRequest(id: string, _prev: CreateState, formData: FormData): Promise<CreateState> {
  const user = await requireUser();
  const intent = formData.get("intent") === "submit" ? "submit" : "draft";

  let input: RequestInput;
  let serviceRendered: boolean;
  try {
    ({ input, serviceRendered } = buildInput(formData));
  } catch (e) {
    if (e instanceof RequestError) return { error: e.message };
    throw e;
  }

  if (intent === "submit" && (await actMissingOnSubmit(user.entityId, input.expenseTypeId, serviceRendered, hasFile(formData, "file_act"), id))) {
    return { error: "Прикрепите подписанный акт выполненных работ — услуга отмечена как оказанная" };
  }

  try {
    await updateRequestForUser(user, id, input);
  } catch (e) {
    if (e instanceof RequestError) return { error: e.message };
    throw e;
  }

  await saveCategorizedFiles(formData, id);

  if (intent === "submit") {
    try { await submitRequestForUser(user, id); } catch (e) { if (!(e instanceof RequestError)) throw e; }
  }

  revalidateRequest(id);
  redirect(`/requests/${id}`);
}

// --- Действия над заявкой: requireUser → сервис → revalidate. Ошибки сервиса
// --- глушим (UI и так показывает актуальный статус после revalidate). ---

async function runAction(id: string, fn: (user: Awaited<ReturnType<typeof requireUser>>, id: string) => Promise<void>) {
  const user = await requireUser();
  try {
    await fn(user, id);
  } catch (e) {
    if (!(e instanceof RequestError)) throw e;
  }
  revalidateRequest(id);
}

export async function submitRequest(id: string): Promise<void> {
  await runAction(id, (u, i) => submitRequestForUser(u, i));
}

// Вариант отправки с обратной связью: ошибка сервиса (например, «нет акта»)
// возвращается на форму, а не глотается молча.
export async function submitRequestWithState(id: string, _prev: CreateState, _formData: FormData): Promise<CreateState> {
  const user = await requireUser();
  try {
    await submitRequestForUser(user, id);
  } catch (e) {
    if (e instanceof RequestError) return { error: e.message };
    throw e;
  }
  revalidateRequest(id);
  return {};
}

export async function approveStep(id: string, comment?: string): Promise<void> {
  await runAction(id, (u, i) => approveStepForUser(u, i, comment));
}

export async function rejectStep(id: string, comment: string): Promise<void> {
  await runAction(id, (u, i) => rejectStepForUser(u, i, comment));
}

export async function requestClarification(id: string, comment: string): Promise<void> {
  await runAction(id, (u, i) => requestClarificationForUser(u, i, comment));
}

export async function cancelRequest(id: string): Promise<void> {
  await runAction(id, (u, i) => cancelRequestForUser(u, i));
}
