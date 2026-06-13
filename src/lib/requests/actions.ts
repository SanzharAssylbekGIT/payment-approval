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
import {
  RequestError,
  createRequestForUser,
  submitRequestForUser,
  approveStepForUser,
  rejectStepForUser,
  requestClarificationForUser,
  cancelRequestForUser,
} from "./service";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

function revalidateRequest(id?: string) {
  revalidatePath("/requests");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/requests/${id}`);
}

async function saveUploadedFile(file: File) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const safeName = file.name.replace(/[^\w.\-а-яё ]/gi, "_");
  const stored = `${randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, stored), buffer);
  return { fileName: file.name, filePath: stored, mimeType: file.type || "application/octet-stream", sizeBytes: buffer.length };
}

const createSchema = z.object({
  expenseTypeId: z.string().min(1, "Выберите вид расхода"),
  projectId: z.string().optional(),
  recipientId: z.string().optional(),
  estimateLineId: z.string().optional(),
  amount: z.string().min(1, "Укажите сумму"),
  purpose: z.string().min(1, "Укажите назначение платежа"),
  priority: z.enum(["CRITICAL", "RELATIONSHIP", "FLEXIBLE"]),
  desiredPayDate: z.string().optional(),
  comment: z.string().optional(),
});

export type CreateState = { error?: string };

// Создание заявки: парсинг формы → сервис → файл → редирект на карточку.
export async function createRequest(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const user = await requireUser();

  const parsed = createSchema.safeParse({
    expenseTypeId: formData.get("expenseTypeId"),
    projectId: formData.get("projectId") || undefined,
    recipientId: formData.get("recipientId") || undefined,
    estimateLineId: formData.get("estimateLineId") || undefined,
    amount: formData.get("amount"),
    purpose: formData.get("purpose"),
    priority: formData.get("priority"),
    desiredPayDate: formData.get("desiredPayDate") || undefined,
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля формы" };

  let amountTiyn: bigint;
  try {
    amountTiyn = parseTengeToTiyn(parsed.data.amount);
  } catch {
    return { error: "Некорректная сумма" };
  }

  let createdId: string;
  try {
    const created = await createRequestForUser(user, {
      expenseTypeId: parsed.data.expenseTypeId,
      projectId: parsed.data.projectId,
      recipientId: parsed.data.recipientId,
      estimateLineId: parsed.data.estimateLineId,
      amountTiyn,
      purpose: parsed.data.purpose,
      priority: parsed.data.priority,
      desiredPayDate: parsed.data.desiredPayDate ? new Date(parsed.data.desiredPayDate) : null,
      comment: parsed.data.comment ?? null,
    });
    createdId = created.id;
  } catch (e) {
    if (e instanceof RequestError) return { error: e.message };
    throw e;
  }

  // Прикреплённый файл (счёт/договор) — опционально.
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const saved = await saveUploadedFile(file);
    await prisma.attachment.create({ data: { requestId: createdId, ...saved } });
  }

  revalidateRequest(createdId);
  redirect(`/requests/${createdId}`);
}

// --- Действия над заявкой: requireUser → сервис → revalidate. Ошибки сервиса
// --- глушим (UI и так показывает актуальный статус после revalidate). ---

async function runAction(id: string, fn: (userId: Parameters<typeof submitRequestForUser>[0], id: string) => Promise<void>) {
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
