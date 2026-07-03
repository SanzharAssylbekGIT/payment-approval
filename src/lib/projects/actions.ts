"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { hasRole } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit";
import { parseTengeToTiyn } from "@/lib/money";
import { EstimateError, saveEstimateVersion, type EstimateLineInput } from "@/lib/estimates/service";
import type { BloggerDeliverable } from "@prisma/client";

export type DealState = { error?: string; ok?: boolean };

const VALID_DELIVERABLES: readonly BloggerDeliverable[] = [
  "STORY", "STORY_SERIES", "REELS", "VIDEO_POST", "PHOTO_POST", "TIKTOK", "YOUTUBE", "OTHER",
];

const dealSchema = z.object({
  name: z.string().min(1, "Укажите название проекта"),
  clientName: z.string().min(1, "Укажите клиента"),
  serviceType: z.enum(["INFLUENCE", "VIDEO_PHOTO", "EVENT", "SPEC_PROJECT"]),
  projectManagerId: z.string().min(1, "Прикрепите проджект-менеджера"),
  realizationDate: z.string().min(1, "Укажите дату реализации"),
  completionDate: z.string().min(1, "Укажите дату завершения"),
  dealAmount: z.string().min(1, "Укажите сумму сделки"),
  productionReserve: z.string().optional(),
  ownerUserId: z.string().optional(), // только для «видящих всё»
  linesJson: z.string().min(1, "Добавьте строки себестоимости"),
});

// Строка таблицы из формы (JSON): блогер/категория + гонорар + форматы + прайс.
interface DealLineRaw {
  bloggerId?: string | null;
  name: string;
  fee: string;
  deliverables?: string[];
  custom?: string;
  base?: string; // прайс из базы (Σ по выбранным форматам), тенге
  isCategory?: boolean;
}

// YYYY-MM-DD → локальная дата; отвергает мусор.
function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new EstimateError("Некорректная дата");
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(dt.getTime()) || dt.getDate() !== Number(m[3])) throw new EstimateError("Некорректная дата");
  return dt;
}

// Создание сделки (DECISIONS §14): проект (пара продажник+проджект, сроки) +
// смета v1 (сумма сделки, НДС авто, себес = продакшн-резерв + гонорары блогеров).
export async function createDeal(_prev: DealState, formData: FormData): Promise<DealState> {
  const user = await requireUser();
  const seeAll = hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO");
  if (!hasRole(user, "ACCOUNT_MANAGER") && !seeAll) return { error: "Заносить проекты могут продажники ком-блока" };

  const parsed = dealSchema.safeParse({
    name: formData.get("name"),
    clientName: formData.get("clientName"),
    serviceType: formData.get("serviceType"),
    projectManagerId: formData.get("projectManagerId"),
    realizationDate: formData.get("realizationDate"),
    completionDate: formData.get("completionDate"),
    dealAmount: formData.get("dealAmount"),
    productionReserve: formData.get("productionReserve") || undefined,
    ownerUserId: formData.get("ownerUserId") || undefined,
    linesJson: formData.get("linesJson"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const d = parsed.data;

  // Проджект: обязателен, с ролью PROJECT_MANAGER.
  const pm = await prisma.user.findFirst({
    where: { id: d.projectManagerId, entityId: user.entityId, isActive: true, roles: { some: { role: "PROJECT_MANAGER" } } },
  });
  if (!pm) return { error: "Проджект-менеджер не найден или не имеет роли проджекта" };

  let realizationDate: Date, completionDate: Date;
  let dealTiyn: bigint, reserveTiyn = 0n;
  try {
    realizationDate = parseDate(d.realizationDate);
    completionDate = parseDate(d.completionDate);
    dealTiyn = parseTengeToTiyn(d.dealAmount);
    if (d.productionReserve) reserveTiyn = parseTengeToTiyn(d.productionReserve);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Некорректные данные" };
  }
  if (completionDate < realizationDate) return { error: "Дата завершения раньше даты реализации" };

  // Строки себестоимости из JSON формы.
  let raw: DealLineRaw[];
  try {
    raw = JSON.parse(d.linesJson);
  } catch {
    return { error: "Не удалось разобрать строки себестоимости" };
  }
  const lines: EstimateLineInput[] = [];
  for (const r of raw) {
    if (!r.name?.trim() && !r.fee?.trim()) continue;
    let fee: bigint;
    try {
      fee = parseTengeToTiyn(r.fee ?? "");
    } catch {
      return { error: `Строка «${r.name || "?"}»: некорректный гонорар` };
    }
    let base: bigint | null = null;
    if (r.base) {
      try { base = parseTengeToTiyn(r.base); } catch { base = null; }
    }
    const deliverables = (r.deliverables ?? []).filter((v): v is BloggerDeliverable =>
      VALID_DELIVERABLES.includes(v as BloggerDeliverable),
    );
    lines.push({
      title: r.name,
      amountTiyn: fee,
      isCategory: !!r.isCategory,
      bloggerId: r.bloggerId || null,
      deliverables,
      customDeliverable: deliverables.includes("OTHER") ? r.custom?.trim() || null : null,
      baseFeeTiyn: base,
    });
  }
  // Продакшн-резерв — часть себестоимости (себес = резерв + гонорары): отдельная
  // категория + depositAmount (для будущего депозита продакшна).
  if (reserveTiyn > 0n) {
    lines.push({ title: "Продакшн-резерв", amountTiyn: reserveTiyn, isCategory: true });
  }

  // Леджер по услуге; клиент — найти или создать.
  const ledgerKind = d.serviceType === "SPEC_PROJECT" ? "SPECPROJECT_0175" : "COST_7366";
  const ledger = await prisma.ledger.findFirst({ where: { entityId: user.entityId, kind: ledgerKind } });
  if (!ledger) return { error: "Не найден леджер для этой услуги" };

  const clientName = d.clientName.trim();
  const existingClient = await prisma.client.findFirst({ where: { entityId: user.entityId, name: clientName } });
  const clientId = existingClient?.id ?? (await prisma.client.create({ data: { entityId: user.entityId, name: clientName } })).id;

  // Владелец: продажник — всегда сам; «видящие всё» могут выбрать.
  const ownerId = seeAll && d.ownerUserId ? d.ownerUserId : user.id;
  const owner = await prisma.user.findFirst({ where: { id: ownerId, entityId: user.entityId } });

  const project = await prisma.project.create({
    data: {
      entityId: user.entityId,
      ledgerId: ledger.id,
      clientId,
      name: d.name.trim(),
      serviceType: d.serviceType,
      ownerUserId: owner?.id ?? user.id,
      projectManagerId: pm.id,
      departmentId: owner?.departmentId ?? user.departmentId,
      realizationDate,
      completionDate,
    },
  });

  try {
    await saveEstimateVersion(user, project.id, {
      clientPriceGrossTiyn: dealTiyn,
      depositTiyn: reserveTiyn,
      lines,
      reason: "INITIAL",
      comment: null,
    });
  } catch (e) {
    // Компенсация: смета не создалась — не оставляем проект-сироту.
    await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
    if (e instanceof EstimateError) return { error: e.message };
    throw e;
  }

  await writeAudit({
    entityId: user.entityId,
    userId: user.id,
    action: "PROJECT_CREATED",
    targetType: "Project",
    targetId: project.id,
    comment: `Сделка «${project.name}»: продажник ${owner?.fullName ?? user.fullName}, проджект ${pm.fullName}`,
  });

  revalidatePath("/projects");
  revalidatePath("/accounting/projects");
  return { ok: true };
}
