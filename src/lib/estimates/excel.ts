// Чтение сметы продакшна из Excel (.xlsx). Ориентир — типовой продюсерский
// шаблон («Vivo - Смета №2»): разделы («A. PRE-PRODUCTION…», «B1. Staff…»),
// строки с колонками № / наименование / кол-во / смены / цена за смену /
// итого (формулой). Эвристика на строку листа:
//   • первый ТЕКСТ — название (числа левее названия — это колонка «№»);
//   • есть положительные числа правее названия → строка-статья:
//     последнее число — сумма; если чисел ≥ 4 и первые три дают её
//     произведением — это кол-во × смены × цена (детали строки);
//   • текст без чисел → заголовок раздела (запоминаем для следующих статей);
//   • «Итого/SUBTOTAL/Total» и шапки таблицы пропускаются.
// Пользователь проверяет и правит строки в окне — файл не сохраняется.

import ExcelJS from "exceljs";

export interface ParsedEstimateRow {
  name: string;
  amount: string; // тенге строкой для input (точка — десятичный разделитель)
  section: string | null; // раздел сметы, к которому относится строка
  qty: string | null; // кол-во (шт.)
  days: string | null; // кол-во смен
  rate: string | null; // цена за смену/шт., тенге
}

const TOTAL_RE = /итог|всего|total/i;
// Шапки таблицы и титул файла — не разделы.
const HEADER_RE = /наименование работ|name of works|production budget|производственная смета|^№\b|^№$/i;

function cellText(v: ExcelJS.CellValue): string | null {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim() || null;
  if (v instanceof Date) return null;
  if (v && typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) {
      const t = v.richText.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
      return t || null;
    }
    if ("result" in v && typeof v.result === "string") return v.result.trim() || null;
    if ("text" in v && typeof v.text === "string") return v.text.trim() || null; // гиперссылка
  }
  return null;
}

function cellNumber(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && "result" in v && typeof v.result === "number") {
    return Number.isFinite(v.result) ? v.result : null; // формула — берём результат
  }
  if (typeof v === "string") {
    const cleaned = v.replace(/[\s₸]/g, "").replace(",", ".");
    if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  }
  return null;
}

// Число → строка тенге для input (до 2 знаков, без хвостовых нулей).
function toAmountString(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export async function parseEstimateXlsx(buffer: Buffer): Promise<ParsedEstimateRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  // Берём первый лист, на котором нашлись строки сметы.
  for (const ws of wb.worksheets) {
    const rows: ParsedEstimateRow[] = [];
    let section: string | null = null;

    ws.eachRow({ includeEmpty: false }, (row) => {
      let name: string | null = null;
      let nameCol = 0;
      const nums: { col: number; val: number }[] = [];

      for (let c = 1; c <= row.cellCount; c++) {
        const v = row.getCell(c).value;
        const num = cellNumber(v);
        if (num !== null) {
          if (num > 0) nums.push({ col: c, val: num });
          continue;
        }
        const t = cellText(v);
        if (t && !name) {
          name = t;
          nameCol = c;
        }
      }

      if (!name) return;
      if (TOTAL_RE.test(name)) return; // итоговые строки не тащим в смету

      // Числа левее названия — колонка «№», к сумме отношения не имеют.
      const useful = nums.filter((n) => n.col > nameCol);

      if (useful.length === 0) {
        // Текст без сумм — заголовок раздела (шапки таблицы отсекаем).
        if (!HEADER_RE.test(name)) section = name;
        return;
      }

      const total = useful[useful.length - 1].val;
      let qty: number | null = null;
      let days: number | null = null;
      let rate: number | null = null;
      if (useful.length >= 4) {
        const [a, b, c] = useful;
        // Детали берём, только если они сходятся с итогом (кол-во × смены × цена).
        if (Math.abs(a.val * b.val * c.val - total) < 0.01) {
          qty = a.val;
          days = b.val;
          rate = c.val;
        }
      }

      rows.push({
        name,
        amount: toAmountString(total),
        section,
        qty: qty !== null ? String(qty) : null,
        days: days !== null ? String(days) : null,
        rate: rate !== null ? toAmountString(rate) : null,
      });
    });

    if (rows.length > 0) {
      dedupeNames(rows);
      return rows;
    }
  }
  return [];
}

// Одинаковые названия в разных разделах («Rent / Аренда») уточняем разделом,
// иначе строки слипнутся в одного получателя проекта.
function dedupeNames(rows: ParsedEstimateRow[]) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  const used = new Map<string, number>();
  for (const r of rows) {
    if ((counts.get(r.name) ?? 0) <= 1) continue;
    const base = r.section ? `${r.name} — ${r.section}` : r.name;
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    r.name = k > 1 ? `${base} (${k})` : base;
  }
}
