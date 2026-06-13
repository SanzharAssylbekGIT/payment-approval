"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { hasRole } from "@/lib/auth/permissions";
import { parseTengeToTiyn } from "@/lib/money";
import { writeAudit } from "@/lib/audit";
import { postIncomingAllocation, PostingError } from "./posting";

function revalidateAccounting() {
  revalidatePath("/accounting");
  revalidatePath("/accounting/incomings");
  revalidatePath("/accounting/projects");
  revalidatePath("/treasury");
  revalidatePath("/dashboard");
}

const incomingSchema = z.object({
  amount: z.string().min(1),
  receivedAt: z.string().min(1),
  projectId: z.string().min(1, "Выберите проект"),
  counterpartyName: z.string().optional(),
});

export type IncomingState = { error?: string; ok?: boolean };

// Регистрация поступления от клиента (бухгалтер/CFO). Статус — «не разнесено».
export async function createIncoming(_prev: IncomingState, formData: FormData): Promise<IncomingState> {
  const user = await requireUser();
  if (!hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO")) return { error: "Нет прав" };

  const parsed = incomingSchema.safeParse({
    amount: formData.get("amount"),
    receivedAt: formData.get("receivedAt"),
    projectId: formData.get("projectId"),
    counterpartyName: formData.get("counterpartyName") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };

  let amountTiyn: bigint;
  try {
    amountTiyn = parseTengeToTiyn(parsed.data.amount);
  } catch {
    return { error: "Некорректная сумма" };
  }
  if (amountTiyn <= 0n) return { error: "Сумма должна быть больше нуля" };

  const project = await prisma.project.findFirst({ where: { id: parsed.data.projectId, entityId: user.entityId } });
  if (!project) return { error: "Проект не найден" };

  const incoming = await prisma.incoming.create({
    data: {
      entityId: user.entityId,
      amount: amountTiyn,
      receivedAt: new Date(parsed.data.receivedAt),
      counterpartyName: parsed.data.counterpartyName ?? null,
      projectId: project.id,
      responsibleUserId: project.ownerUserId,
      status: "UNALLOCATED",
    },
  });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "INCOMING_CREATED", targetType: "Incoming", targetId: incoming.id, comment: `Поступление ${parsed.data.amount} ₸` });

  revalidateAccounting();
  return { ok: true };
}

// Разнести поступление по смете (НДС/себестоимость/маржа). DECISIONS §4.
export async function allocateIncoming(id: string): Promise<void> {
  const user = await requireUser();
  if (!hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO")) return;
  try {
    await postIncomingAllocation(user, id);
  } catch (e) {
    if (!(e instanceof PostingError)) throw e;
  }
  revalidateAccounting();
}
