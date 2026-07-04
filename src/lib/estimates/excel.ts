// Чтение сметы продакшна из Excel (.xlsx): продюсер загружает свой файл,
// система вытаскивает строки «название + сумма» для редактируемой таблицы
// в окне создания проекта. Формат файла заранее неизвестен, поэтому эвристика:
// в каждой строке берём первый текст (не число) как название и ПОСЛЕДНЕЕ
// положительное число как сумму; итоговые строки («Итого», «Всего») пропускаем.
// Пользователь всё равно проверяет и правит строки перед сохранением.

import ExcelJS from "exceljs";

export interface ParsedEstimateRow {
  name: string;
  amount: string; // тенге строкой для input (точка — десятичный разделитель)
}

const TOTAL_RE = /итог|всего|total/i;

function cellText(v: ExcelJS.CellValue): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (v instanceof Date) return null;
  if (v && typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) {
      const t = v.richText.map((r) => r.text).join("").trim();
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
    return Number.isFinite(v.result) ? v.result : null; // формула
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
    ws.eachRow({ includeEmpty: false }, (row) => {
      let name: string | null = null;
      let amount: number | null = null;
      for (let c = 1; c <= row.cellCount; c++) {
        const v = row.getCell(c).value;
        const num = cellNumber(v);
        if (num !== null) {
          if (num > 0) amount = num; // последнее положительное число в строке
          continue;
        }
        if (!name) name = cellText(v);
      }
      if (!name || amount === null) return;
      if (TOTAL_RE.test(name)) return; // итоговые строки не тащим в смету
      rows.push({ name, amount: toAmountString(amount) });
    });
    if (rows.length > 0) return rows;
  }
  return [];
}
