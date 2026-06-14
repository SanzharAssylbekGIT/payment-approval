// Парсер банковской выписки Kaspi (.xlsx, лист "Восстановл_Лист1").
// Формат: блок реквизитов сверху, затем таблица операций с колонками
// № док | Дата операции | Дебет | Кредит | Бенефициар | ИИК | БИК | КНП | Назначение.
// Все суммы → тиыны (BigInt). Дебет = отток (DEBIT), Кредит = приток (CREDIT).

import * as XLSX from "xlsx";

export type StatementDirection = "DEBIT" | "CREDIT";

export interface ParsedStatementLine {
  docNumber: string;
  occurredAt: Date;
  direction: StatementDirection;
  amountTiyn: bigint;
  counterparty: string;
  iban: string;
  knp: string;
  purpose: string;
}

export interface ParsedStatement {
  accountCode: string | null; // 4 последние цифры счёта: 6890 / 7366 / 3098 / 0175
  accountNumber: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  openingBalanceTiyn: bigint | null;
  closingBalanceTiyn: bigint | null;
  lines: ParsedStatementLine[];
}

// "2,000,000.00" → 200000000n тиын. Запятая = разделитель тысяч, точка = дробь.
function amountToTiyn(v: unknown): bigint {
  if (v == null || v === "") return 0n;
  const s = String(v).replace(/[\s₸]/g, "").replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0n;
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace("-", "").split(".");
  const tiyn = BigInt(int) * 100n + BigInt((frac + "00").slice(0, 2));
  return neg ? -tiyn : tiyn;
}

// "29.05.2026 18:02:22" → Date.
function parseDate(v: unknown): Date | null {
  const m = String(v ?? "").match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, hh = "0", mm = "0", ss = "0"] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
}

const cleanName = (v: unknown) => String(v ?? "").split("\n")[0].replace(/ИИН.*/i, "").trim();

function cellAfterLabel(rows: unknown[][], label: string): string | null {
  const row = rows.find((r) => String(r[0] ?? "").includes(label));
  if (!row) return null;
  for (let i = 1; i < row.length; i++) if (row[i]) return String(row[i]).trim();
  return null;
}

export function parseKaspiStatement(buf: Buffer): ParsedStatement {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets["Восстановл_Лист1"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, blankrows: false }) as unknown[][];

  const accountNumber = cellAfterLabel(rows, "Текущий счет");
  const accountCode = accountNumber ? accountNumber.replace(/\s/g, "").slice(-4) : null;
  const period = cellAfterLabel(rows, "Период") ?? "";
  const [periodFrom = null, periodTo = null] = period.split("-").map((s) => s.trim());
  const openingBalanceTiyn = rows.some((r) => String(r[0] ?? "").includes("Входящий остаток"))
    ? amountToTiyn((rows.find((r) => String(r[0] ?? "").includes("Входящий остаток")) ?? [])[2])
    : null;
  const closingBalanceTiyn = rows.some((r) => String(r[0] ?? "").includes("Исходящий остаток"))
    ? amountToTiyn((rows.find((r) => String(r[0] ?? "").includes("Исходящий остаток")) ?? [])[2])
    : null;

  const h = rows.findIndex((r) => r.some((c) => String(c).includes("Дебет")));
  const lines: ParsedStatementLine[] = [];
  if (h >= 0) {
    for (const r of rows.slice(h + 2)) {
      const occurredAt = parseDate(r[1]);
      if (!occurredAt) continue; // строки без даты = итоги/служебные
      const debit = amountToTiyn(r[2]);
      const credit = amountToTiyn(r[3]);
      if (debit === 0n && credit === 0n) continue;
      lines.push({
        docNumber: String(r[0] ?? "").trim(),
        occurredAt,
        direction: debit > 0n ? "DEBIT" : "CREDIT",
        amountTiyn: debit > 0n ? debit : credit,
        counterparty: cleanName(r[4]),
        iban: String(r[5] ?? "").trim(),
        knp: String(r[7] ?? "").trim(),
        purpose: String(r[8] ?? "").trim(),
      });
    }
  }

  return { accountCode, accountNumber, periodFrom, periodTo, openingBalanceTiyn, closingBalanceTiyn, lines };
}

// КНП, которые НЕ являются клиентской выручкой / расходом по проектам.
export const KNP_INTERNAL_TRANSFER = "342"; // перевод собственных средств
export const KNP_NON_REVENUE: Record<string, string> = {
  "213": "продажа валюты",
  "411": "займы",
  "880": "возвраты",
  "352": "проценты банка",
};
