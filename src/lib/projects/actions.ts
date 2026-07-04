"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { hasRole, canSeeEverything } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit";
import { parseTengeToTiyn } from "@/lib/money";
import { EstimateError, saveEstimateVersion, getScopedProject, type EstimateLineInput } from "@/lib/estimates/service";
import { parseEstimateXlsx, type ParsedEstimateRow } from "@/lib/estimates/excel";
import { createProjectNumbered } from "@/lib/projects/numbering";
import type { BloggerDeliverable } from "@prisma/client";

export type DealState = { error?: string; ok?: boolean };

const VALID_DELIVERABLES: readonly BloggerDeliverable[] = [
  "STORY", "STORY_SERIES", "REELS", "VIDEO_POST", "PHOTO_POST", "TIKTOK", "YOUTUBE", "OTHER",
];

const dealSchema = z.object({
  name: z.string().min(1, "Укажите название проекта"),
  clientId: z.string().min(1, "Выберите клиента из списка"),
  serviceType: z.enum(["INFLUENCE", "VIDEO_PHOTO", "EVENT", "SPEC_PROJECT"]),
  projectManagerId: z.string().min(1, "Прикрепите проджект-менеджера"),
  realizationDate: z.string().min(1, "Укажите дату утверждения проекта"),
  completionDate: z.string().min(1, "Укажите запланированную дату завершения"),
  dealAmount: z.string().min(1, "Укажите сумму сделки"),
  ownerUserId: z.string().optional(), // только для «видящих всё»
  linesJson: z.string().min(1, "Добавьте строки себестоимости"),
});

// Строка таблицы из формы (JSON): блогер + опция из прайса (или своя) + гонорар.
interface DealLineRaw {
  bloggerId?: string | null;
  name: string;
  fee: string; // гонорар = себес с налогом, тенге
  reserve?: string | null; // продакшн-резерв по этой строке (блогер × опция), тенге
  optionName?: string | null; // опция из прайса блогера
  kind?: string | null; // маппинг опции на стандартный формат
  custom?: string | null; // своя опция текстом
  base?: string; // прайс опции (себес с налогом) на момент сделки, тенге
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
    clientId: formData.get("clientId"),
    serviceType: formData.get("serviceType"),
    projectManagerId: formData.get("projectManagerId"),
    realizationDate: formData.get("realizationDate"),
    completionDate: formData.get("completionDate"),
    dealAmount: formData.get("dealAmount"),
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
  let dealTiyn: bigint;
  try {
    realizationDate = parseDate(d.realizationDate);
    completionDate = parseDate(d.completionDate);
    dealTiyn = parseTengeToTiyn(d.dealAmount);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Некорректные данные" };
  }
  if (completionDate < realizationDate) return { error: "Запланированная дата завершения раньше даты утверждения проекта" };

  // Строки себестоимости из JSON формы.
  let raw: DealLineRaw[];
  try {
    raw = JSON.parse(d.linesJson);
  } catch {
    return { error: "Не удалось разобрать строки себестоимости" };
  }
  const lines: EstimateLineInput[] = [];
  let reserveTotalTiyn = 0n; // Σ резервов строк → depositAmount (продакшн-депозит)
  for (const r of raw) {
    if (!r.name?.trim() && !r.fee?.trim()) continue;
    let fee: bigint;
    try {
      fee = parseTengeToTiyn(r.fee ?? "");
    } catch {
      return { error: `Строка «${r.name || "?"}»: некорректный гонорар` };
    }
    // Продакшн-резерв считается по каждому блогеру и каждой опции отдельно.
    let reserve = 0n;
    if (r.reserve?.trim()) {
      try {
        reserve = parseTengeToTiyn(r.reserve);
      } catch {
        return { error: `Строка «${r.name || "?"}»: некорректный продакшн-резерв` };
      }
    }
    reserveTotalTiyn += reserve;
    let base: bigint | null = null;
    if (r.base) {
      try { base = parseTengeToTiyn(r.base); } catch { base = null; }
    }
    const kind = r.kind && VALID_DELIVERABLES.includes(r.kind as BloggerDeliverable) ? (r.kind as BloggerDeliverable) : null;
    // Опция: из прайса блогера либо своя текстом — хранится в customDeliverable.
    const optionText = r.optionName?.trim() || r.custom?.trim() || null;
    lines.push({
      title: r.name,
      amountTiyn: fee,
      reserveTiyn: reserve,
      isCategory: !!r.isCategory,
      bloggerId: r.bloggerId || null,
      deliverables: kind ? [kind] : optionText ? ["OTHER"] : [],
      customDeliverable: optionText,
      baseFeeTiyn: base,
    });
  }

  // Леджер по услуге; клиент — найти или создать.
  const ledgerKind = d.serviceType === "SPEC_PROJECT" ? "SPECPROJECT_0175" : "COST_7366";
  const ledger = await prisma.ledger.findFirst({ where: { entityId: user.entityId, kind: ledgerKind } });
  if (!ledger) return { error: "Не найден леджер для этой услуги" };

  // Клиент — только из справочника (добавление нового — отдельным действием).
  const client = await prisma.client.findFirst({ where: { id: d.clientId, entityId: user.entityId } });
  if (!client) return { error: "Клиент не найден — выберите из списка или добавьте нового" };

  // Владелец: продажник — всегда сам; «видящие всё» могут выбрать.
  const ownerId = seeAll && d.ownerUserId ? d.ownerUserId : user.id;
  const owner = await prisma.user.findFirst({ where: { id: ownerId, entityId: user.entityId } });

  // Номер проекта присваивает система — сквозной по компании.
  const project = await createProjectNumbered({
    entityId: user.entityId,
    ledgerId: ledger.id,
    clientId: client.id,
    name: d.name.trim(),
    serviceType: d.serviceType,
    ownerUserId: owner?.id ?? user.id,
    projectManagerId: pm.id,
    departmentId: owner?.departmentId ?? user.departmentId,
    realizationDate,
    completionDate,
  });

  try {
    await saveEstimateVersion(user, project.id, {
      clientPriceGrossTiyn: dealTiyn,
      depositTiyn: reserveTotalTiyn,
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
    comment: `Проект № ${project.number} «${project.name}»: продажник ${owner?.fullName ?? user.fullName}, проджект ${pm.fullName}`,
  });

  revalidatePath("/projects");
  revalidatePath("/accounting/projects");
  return { ok: true };
}

export type ParseEstimateResult = { rows?: ParsedEstimateRow[]; error?: string };

// Смета продакшна из Excel (.xlsx): продюсер загружает файл в окне создания
// проекта, строки выводятся в редактируемую таблицу. Файл НЕ сохраняется —
// источник правды остаётся смета в системе после правок пользователя.
export async function parseEstimateExcel(formData: FormData): Promise<ParseEstimateResult> {
  const user = await requireUser();
  const seeAll = hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO");
  if (!hasRole(user, "ACCOUNT_MANAGER") && !seeAll) return { error: "Нет прав создавать проекты" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите файл со сметой" };
  if (file.size > 10 * 1024 * 1024) return { error: "Файл больше 10 МБ" };
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return { error: "Поддерживается только .xlsx — пересохраните файл в Excel как «Книга Excel (.xlsx)»" };
  }

  try {
    const rows = await parseEstimateXlsx(Buffer.from(await file.arrayBuffer()));
    if (rows.length === 0) return { error: "Не нашёл в файле строк «название + сумма» — проверьте лист со сметой" };
    if (rows.length > 300) return { error: `В файле ${rows.length} строк — слишком много для сметы, проверьте лист` };
    return { rows };
  } catch {
    return { error: "Не удалось прочитать файл — убедитесь, что это корректный .xlsx" };
  }
}

export type NewClientResult = { client?: { id: string; name: string }; error?: string };

const clientSchema = z.object({
  name: z.string().trim().min(1, "Укажите название клиента").max(200, "Слишком длинное название"),
  legalName: z.string().trim().max(300, "Слишком длинное юр. название").optional(),
  companyForm: z.enum(["IP", "TOO", "AO", "CHK"], { message: "Выберите форму компании" }),
  isForeign: z.boolean(),
  bin: z.string().trim().optional(),
  bankAccount: z.string().trim().optional(),
  bankName: z.string().trim().max(200, "Слишком длинное название банка").optional(),
});

export type NewClientInput = z.input<typeof clientSchema>;

// Добавление клиента в справочник (окно «Новый клиент» при создании проекта).
// КБЕ считает система из формы компании и резидентства; дубликаты по имени
// не создаём — просим выбрать существующего из списка.
export async function createClient(input: NewClientInput): Promise<NewClientResult> {
  const user = await requireUser();
  const seeAll = hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO");
  if (!hasRole(user, "ACCOUNT_MANAGER") && !seeAll) return { error: "Нет прав добавлять клиентов" };

  const parsed = clientSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const d = parsed.data;

  // БИН: 12 цифр (если указан — у иностранных компаний его может не быть).
  const bin = d.bin?.replace(/\s/g, "") || null;
  if (bin && !/^\d{12}$/.test(bin)) return { error: "БИН должен состоять из 12 цифр" };

  // Номер счёта: казахстанский IBAN — KZ + 18 знаков; иностранные — не строже 34.
  const account = d.bankAccount?.replace(/\s/g, "").toUpperCase() || null;
  if (account) {
    if (account.startsWith("KZ") && !/^KZ[0-9A-Z]{18}$/.test(account)) {
      return { error: "Казахстанский счёт (IBAN) — это KZ и ещё 18 символов" };
    }
    if (!/^[0-9A-Z]{5,34}$/.test(account)) return { error: "Некорректный номер счёта" };
  }

  const existing = await prisma.client.findFirst({
    where: { entityId: user.entityId, name: { equals: d.name, mode: "insensitive" } },
  });
  if (existing) return { error: `Клиент «${existing.name}» уже есть — выберите его из списка` };

  // КБЕ: 1-я цифра — резидентство (1/2), 2-я — сектор (9 ИП / 7 юрлицо).
  const kbe = (d.isForeign ? "2" : "1") + (d.companyForm === "IP" ? "9" : "7");

  const created = await prisma.client.create({
    data: {
      entityId: user.entityId,
      name: d.name,
      legalName: d.legalName || null,
      companyForm: d.companyForm,
      isForeign: d.isForeign,
      bin,
      bankAccount: account,
      bankName: d.bankName || null,
      kbe,
    },
  });
  await writeAudit({
    entityId: user.entityId,
    userId: user.id,
    action: "CLIENT_CREATED",
    targetType: "Client",
    targetId: created.id,
    comment: `Добавлен клиент «${created.name}» (КБЕ ${kbe}${bin ? `, БИН ${bin}` : ""})`,
  });
  revalidatePath("/projects");
  return { client: { id: created.id, name: created.name } };
}

// Закрытие проекта (пара продажник/проджект или финансы). Заявки «в полёте»
// блокируют закрытие — сначала доведите оплаты или отмените заявки.
export async function closeProject(id: string): Promise<void> {
  const user = await requireUser();
  const project = await getScopedProject(user, id);
  if (!project) return;
  const allowed = canSeeEverything(user) || project.ownerUserId === user.id || project.projectManagerId === user.id;
  if (!allowed) return;

  const inFlight = await prisma.paymentRequest.count({
    where: { projectId: id, status: { in: ["PENDING_APPROVAL", "APPROVED", "IN_REGISTER"] } },
  });
  if (inFlight > 0) return; // UI дизейблит кнопку; guard — на случай гонки

  const claimed = await prisma.project.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CLOSED" } });
  if (claimed.count === 0) return;
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "PROJECT_CLOSED", targetType: "Project", targetId: id, comment: `Проект «${project.name}» закрыт` });
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  revalidatePath("/accounting/projects");
}

// Переоткрытие закрытого проекта.
export async function reopenProject(id: string): Promise<void> {
  const user = await requireUser();
  const project = await getScopedProject(user, id);
  if (!project) return;
  const allowed = canSeeEverything(user) || project.ownerUserId === user.id || project.projectManagerId === user.id;
  if (!allowed) return;

  const claimed = await prisma.project.updateMany({ where: { id, status: "CLOSED" }, data: { status: "ACTIVE" } });
  if (claimed.count === 0) return;
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "PROJECT_REOPENED", targetType: "Project", targetId: id, comment: `Проект «${project.name}» переоткрыт` });
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
  revalidatePath("/accounting/projects");
}
