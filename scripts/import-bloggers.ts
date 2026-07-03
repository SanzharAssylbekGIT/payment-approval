// Импорт базы блогеров из Excel («Brave Price» + «Non-standart price»).
// Идемпотентен: блогеры апсертятся по имени, прайс каждого блогера полностью
// обновляется (повторный запуск не дублирует). DECISIONS §14.4.
//
//   npx tsx scripts/import-bloggers.ts "C:/путь/к/файлу.xlsx"
//   npm run bloggers:import -- "C:/путь/к/файлу.xlsx"

import ExcelJS from "exceljs";
import { PrismaClient, type BloggerDeliverable } from "@prisma/client";

const prisma = new PrismaClient();
const ENTITY_ID = "entity_bravetalents";
const DEMO_NAMES = ["Блогер Айбек", "Блогер Динара", "Блогер Санжик"];

// ---------- helpers ----------

function cellStr(c: ExcelJS.Cell): string {
  const v = c.value as unknown;
  if (v == null) return "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return String(o.result ?? "");
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    if (v instanceof Date) return "";
    return "";
  }
  return String(v);
}

// Число из ячейки (тенге) → тиыны; null если не число.
function toTiyn(c: ExcelJS.Cell): bigint | null {
  const raw = c.value as unknown;
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "object" && raw != null && "result" in (raw as object)) {
    const r = (raw as { result: unknown }).result;
    if (typeof r !== "number") return null;
    n = r;
  } else {
    const s = cellStr(c).replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
  }
  if (!Number.isFinite(n) || n <= 0) return null;
  return BigInt(Math.round(n * 100));
}

// Просто число из ячейки (без перевода в тиыны); null если не число.
function toNum(c: ExcelJS.Cell): number | null {
  const raw = c.value as unknown;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "object" && raw != null && "result" in (raw as object)) {
    const r = (raw as { result: unknown }).result;
    return typeof r === "number" && Number.isFinite(r) ? r : null;
  }
  const s = cellStr(c).replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// Налог: в файле доля (0.1) либо проценты (10) → всегда проценты (10).
function toTaxPct(c: ExcelJS.Cell): number | null {
  const n = toNum(c);
  if (n == null || n <= 0) return null;
  const pct = n < 1 ? n * 100 : n;
  return pct > 0 && pct < 100 ? Math.round(pct) : null;
}

// «Женис Омаров (zheka_fatbelly) » → «Женис Омаров» (для сшивки листов).
function normalizeName(s: string): string {
  return s.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}

function cleanOption(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 120);
}

// Маппинг опции на стандартный формат (для группировки); нестандарт → OTHER.
function mapKind(option: string, link: string): BloggerDeliverable {
  const o = option.toLowerCase();
  const l = link.toLowerCase();
  if (l.includes("tiktok") || o.includes("тикток") || o.includes("tiktok") || o === "видео в тт") return "TIKTOK";
  if (l.includes("youtu") || o.includes("youtube") || o.includes("ютуб") || o.includes("shorts") || o.includes("преролл") || o.includes("mid-roll")) return "YOUTUBE";
  if (o.includes("блок сторис") || o.includes("серия сторис")) return "STORY_SERIES";
  if (o.includes("сторис")) return "STORY";
  if (o.includes("фотопост")) return "PHOTO_POST";
  if (o.includes("видеопост")) return "VIDEO_POST";
  if (o.includes("рилс") || o.includes("reels")) return "REELS";
  if (l.includes("tiktok")) return "TIKTOK";
  return "OTHER";
}

// Gross-up: себес с налогом = себес / (1 − налог%), округление half-up до тиына.
function grossUp(net: bigint, taxPct: number): bigint {
  const den = BigInt(100 - taxPct);
  return (net * 100n + den / 2n) / den;
}

// ---------- parsing ----------

interface Option {
  name: string;
  kind: BloggerDeliverable;
  price: bigint;
  taxPct: number | null;
  priceWithTax: bigint;
}
interface Parsed {
  link: string | null;
  taxPct: number | null;
  options: Map<string, Option>;
  skipped: string[];
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Укажите путь к xlsx: npx tsx scripts/import-bloggers.ts <файл>");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  const bloggers = new Map<string, Parsed>(); // ключ — нормализованное имя
  const get = (name: string): Parsed => {
    const key = normalizeName(name);
    if (!bloggers.has(key)) bloggers.set(key, { link: null, taxPct: null, options: new Map(), skipped: [] });
    return bloggers.get(key)!;
  };

  // --- Лист «Brave Price»: себес (F), себес с налогом (G), налог (M) ---
  const brave = wb.getWorksheet("Brave Price");
  if (!brave) throw new Error("Лист «Brave Price» не найден");
  for (let r = 3; r <= brave.rowCount; r++) {
    const row = brave.getRow(r);
    const rawName = cellStr(row.getCell(2)).trim();
    if (!rawName) continue;
    const b = get(rawName);
    const link = cellStr(row.getCell(3)).trim();
    if (!b.link && link.includes("instagram")) b.link = link;
    const option = cleanOption(cellStr(row.getCell(5)));
    if (!option) continue;

    const taxPct = toTaxPct(row.getCell(13));
    if (taxPct != null && b.taxPct == null) b.taxPct = taxPct;

    const net = toTiyn(row.getCell(6));
    if (net == null) {
      b.skipped.push(`${option} — «${cellStr(row.getCell(6)).trim() || "пусто"}»`);
      continue;
    }
    const withTaxCell = toTiyn(row.getCell(7));
    const tax = b.taxPct ?? 0;
    const priceWithTax = withTaxCell ?? (tax > 0 ? grossUp(net, tax) : net);
    if (!b.options.has(option)) {
      b.options.set(option, { name: option, kind: mapKind(option, link), price: net, taxPct: b.taxPct, priceWithTax });
    }
  }

  // --- Лист «Non-standart price»: нестандартные опции с числовым себесом (F) ---
  const nonstd = wb.getWorksheet("Non-standart price");
  if (nonstd) {
    for (let r = 4; r <= nonstd.rowCount; r++) {
      const row = nonstd.getRow(r);
      const rawName = cellStr(row.getCell(2)).trim();
      if (!rawName) continue;
      const key = normalizeName(rawName);
      // Только СВОИ блогеры (уже встреченные в Brave Price) — прочих не заводим.
      if (!bloggers.has(key)) continue;
      const b = bloggers.get(key)!;
      const option = cleanOption(cellStr(row.getCell(5)));
      if (!option || b.options.has(option)) continue;
      const net = toTiyn(row.getCell(6));
      if (net == null) {
        const raw = cellStr(row.getCell(6)).trim();
        if (raw) b.skipped.push(`${option} — «${raw}»`);
        continue;
      }
      const tax = b.taxPct ?? 0;
      b.options.set(option, {
        name: option,
        kind: mapKind(option, cellStr(row.getCell(3)).trim()),
        price: net,
        taxPct: b.taxPct,
        priceWithTax: tax > 0 ? grossUp(net, tax) : net,
      });
    }
  }

  // --- Запись в БД ---
  let created = 0, updated = 0, optionsTotal = 0, skippedTotal = 0;
  for (const [name, b] of bloggers) {
    if (b.options.size === 0 && !b.link) continue;
    const existing = await prisma.blogger.findUnique({ where: { entityId_name: { entityId: ENTITY_ID, name } } });
    const rec = await prisma.blogger.upsert({
      where: { entityId_name: { entityId: ENTITY_ID, name } },
      update: { link: b.link ?? undefined, isActive: true },
      create: { entityId: ENTITY_ID, name, link: b.link },
    });
    existing ? updated++ : created++;

    // Полное обновление прайса блогера (идемпотентно).
    await prisma.bloggerPrice.deleteMany({ where: { bloggerId: rec.id } });
    await prisma.bloggerPrice.createMany({
      data: [...b.options.values()].map((o) => ({
        bloggerId: rec.id,
        name: o.name,
        kind: o.kind,
        price: o.price,
        taxPct: o.taxPct,
        priceWithTax: o.priceWithTax,
      })),
    });
    optionsTotal += b.options.size;
    skippedTotal += b.skipped.length;
  }

  // Демо-блогеров прячем из формы после загрузки реальной базы.
  await prisma.blogger.updateMany({
    where: { entityId: ENTITY_ID, name: { in: DEMO_NAMES } },
    data: { isActive: false },
  });

  console.log(`Блогеров: создано ${created}, обновлено ${updated}. Опций прайса: ${optionsTotal}. Пропущено строк: ${skippedTotal}.`);
  for (const [name, b] of bloggers) {
    if (b.skipped.length) console.log(`  ~ ${name}: пропущено ${b.skipped.length} — ${b.skipped.slice(0, 3).join("; ")}${b.skipped.length > 3 ? "…" : ""}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
