// Импорт помесячного бюджета бэк-офиса (6890) из Excel CFO (DECISIONS §22).
// Формат файла: колонка A — ответственный (игнорируем), B — статья, C — сумма
// в месяц (₸, может быть дробной), D — комментарий (игнорируем). Строки
// «Итого…»/«Всего» пропускаются, «Резерв» заводится статьёй.
//
//   npx tsx scripts/import-budget.ts "путь/к/файлу.xlsx" [год] [месяц]
//
// Идемпотентен: статья ищется по названию внутри периода — существующая
// обновляется (план), новая создаётся. Лишние строки НЕ удаляются.
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const prisma = new PrismaClient();
const ENTITY_ID = "entity_bravetalents";
const TOTAL_RE = /^(итого|всего)/i;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "richText" in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  if (typeof v === "object" && "result" in (v as object)) return cellText((v as { result: unknown }).result);
  return String(v);
}

function cellNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in (v as object)) return cellNumber((v as { result: unknown }).result);
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const [file, yearArg, monthArg] = process.argv.slice(2);
  if (!file) throw new Error('Использование: npx tsx scripts/import-budget.ts "файл.xlsx" [год] [месяц]');
  const now = new Date();
  const year = yearArg ? Number(yearArg) : now.getFullYear();
  const month = monthArg ? Number(monthArg) : now.getMonth() + 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Некорректный год/месяц");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("В файле нет листов");

  const rows: { title: string; tiyn: bigint }[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const title = cellText(row.getCell(2).value).trim();
    if (!title || TOTAL_RE.test(title)) return;
    const raw = row.getCell(3).value;
    const isEmpty = raw === null || raw === undefined || cellText(raw).trim() === "";
    const amount = cellNumber(raw);
    // Текст в C (не число) — шапка таблицы, пропускаем. ПУСТАЯ C — валидная
    // статья без плана (план 0: подавать на неё можно, лимита нет).
    if (!isEmpty && amount === null) return;
    rows.push({ title, tiyn: BigInt(Math.round((amount ?? 0) * 100)) });
  });
  if (rows.length === 0) throw new Error("Не найдено ни одной статьи (колонка B — название, C — сумма)");

  let period = await prisma.budgetPeriod.findFirst({ where: { entityId: ENTITY_ID, year, month } });
  if (!period) period = await prisma.budgetPeriod.create({ data: { entityId: ENTITY_ID, year, month } });

  let created = 0,
    updated = 0;
  for (const r of rows) {
    const existing = await prisma.budgetLine.findFirst({ where: { periodId: period.id, title: r.title } });
    if (existing) {
      if (existing.plannedAmount !== r.tiyn) {
        await prisma.budgetLine.update({ where: { id: existing.id }, data: { plannedAmount: r.tiyn } });
        updated++;
      }
    } else {
      await prisma.budgetLine.create({ data: { periodId: period.id, title: r.title, plannedAmount: r.tiyn } });
      created++;
    }
  }

  const total = rows.reduce((s, r) => s + r.tiyn, 0n);
  console.log(`Бюджет ${String(month).padStart(2, "0")}.${year}: статей ${rows.length} (создано ${created}, обновлено ${updated})`);
  console.log(`План на месяц: ${total} тиын = ${(Number(total) / 100).toLocaleString("ru-RU")} ₸`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
