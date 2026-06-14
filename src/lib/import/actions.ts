"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { markPaid, TreasuryError } from "@/lib/treasury/service";
import { importStatement, createIncomingFromLine, ImportError } from "./service";

export type ImportState = { error?: string };

// Загрузка файла выписки → импорт → редирект на разбор.
export async function uploadStatement(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите файл выписки (.xlsx)" };

  let importId: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    importId = await importStatement(user, file.name, buf);
  } catch (e) {
    if (e instanceof ImportError) return { error: e.message };
    throw e;
  }
  revalidatePath("/accounting/import");
  redirect(`/accounting/import/${importId}`);
}

// Подтвердить оплату по сматченной строке списания (отметить заявку оплаченной).
export async function confirmLinePaid(lineId: string): Promise<void> {
  const user = await requireUser();
  const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId, import: { entityId: user.entityId } } });
  if (!line?.matchedRequestId) return;
  try {
    await markPaid(user, line.matchedRequestId, line.occurredAt);
    await prisma.bankStatementLine.update({ where: { id: lineId }, data: { matched: true } });
  } catch (e) {
    if (!(e instanceof TreasuryError)) throw e;
  }
  revalidatePath(`/accounting/import/${line.importId}`);
  revalidatePath("/payments");
}

// Создать поступление из строки-кредита (привязка к проекту).
export async function createIncomingForLine(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireUser();
  const lineId = String(formData.get("lineId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Выберите проект" };
  let importId = "";
  try {
    const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId }, select: { importId: true } });
    importId = line?.importId ?? "";
    await createIncomingFromLine(user, lineId, projectId);
  } catch (e) {
    if (e instanceof ImportError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/accounting/import/${importId}`);
  revalidatePath("/accounting/incomings");
  return {};
}
