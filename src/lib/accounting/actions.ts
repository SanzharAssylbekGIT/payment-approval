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

const projectSchema = z.object({
  name: z.string().min(1, "Укажите название проекта"),
  clientName: z.string().min(1, "Укажите клиента"),
  serviceType: z.enum(["INFLUENCE", "VIDEO_PHOTO", "EVENT", "SPEC_PROJECT"]),
  ownerUserId: z.string().optional(),
});

export type ProjectState = { error?: string; ok?: boolean };

// Создание проекта ответственным (CFO/бухгалтерия). Услуга определяет леджер:
// спецпроект → 0175, остальное → 7366. Владелец задаёт департамент — от него
// зависит, кто увидит проект в форме заявки (конфиденциальность, CLAUDE.md §10).
export async function createProject(_prev: ProjectState, formData: FormData): Promise<ProjectState> {
  const user = await requireUser();
  if (!hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO")) return { error: "Нет прав" };

  const parsed = projectSchema.safeParse({
    name: formData.get("name"),
    clientName: formData.get("clientName"),
    serviceType: formData.get("serviceType"),
    ownerUserId: formData.get("ownerUserId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const d = parsed.data;

  const ledgerKind = d.serviceType === "SPEC_PROJECT" ? "SPECPROJECT_0175" : "COST_7366";
  const ledger = await prisma.ledger.findFirst({ where: { entityId: user.entityId, kind: ledgerKind } });
  if (!ledger) return { error: "Не найден леджер для этой услуги" };

  const clientName = d.clientName.trim();
  const existingClient = await prisma.client.findFirst({ where: { entityId: user.entityId, name: clientName } });
  const clientId = existingClient?.id ?? (await prisma.client.create({ data: { entityId: user.entityId, name: clientName } })).id;

  const owner = d.ownerUserId ? await prisma.user.findFirst({ where: { id: d.ownerUserId, entityId: user.entityId } }) : null;

  const project = await prisma.project.create({
    data: {
      entityId: user.entityId,
      ledgerId: ledger.id,
      clientId,
      name: d.name.trim(),
      serviceType: d.serviceType,
      ownerUserId: owner?.id ?? null,
      departmentId: owner?.departmentId ?? null,
    },
  });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "PROJECT_CREATED", targetType: "Project", targetId: project.id, comment: `Создан проект «${project.name}»` });

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
