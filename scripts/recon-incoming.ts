import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parseKaspiStatement, KNP_INTERNAL_TRANSFER, KNP_NON_REVENUE } from "@/lib/import/kaspi";

const DIR = path.join(process.cwd(), "import-samples");
const files = readdirSync(DIR).filter((f) => f.endsWith(".xlsx"));
const find = (sub: string) => path.join(DIR, files.find((x) => x.toLowerCase().includes(sub.toLowerCase()))!);
const tng = (t: bigint) => Number(t) / 100; // тиыны → тенге (число для Excel)
const fmt = (t: bigint) => tng(t).toLocaleString("ru-RU");
const num = (v: unknown): bigint => {
  if (v == null || v === "") return 0n;
  const s = String(v).replace(/[\s₸,]/g, "").replace(/[^\d.\-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0n;
  const [i, f = ""] = s.replace("-", "").split(".");
  return BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
};
const norm = (s: string) => s.toLowerCase().replace(/(тоо|ип|ооо|чк|ао|товариществосограниченнойответственностью|индивидуальныйпредприниматель)/g, "").replace(/[^a-zа-я0-9]/gi, "");
const nameSim = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  if (x.length < 3 || y.length < 3) return false;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return l.includes(s.slice(0, Math.min(10, s.length)));
};
const abs = (n: bigint) => (n < 0n ? -n : n);

const FOREIGN = ["KT&G", "d'Alba", "INNOVATEER", "3D-OUTLET"];

const bankLines = [...parseKaspiStatement(readFileSync(find("6890"))).lines, ...parseKaspiStatement(readFileSync(find("7366"))).lines];
const credits = bankLines.filter((l) => l.direction === "CREDIT" && l.knp !== KNP_INTERNAL_TRANSFER);
const clientCredits = credits.filter((c) => !KNP_NON_REVENUE[c.knp]).map((c) => ({ ...c, used: false }));
const nonRevenue = credits.filter((c) => KNP_NON_REVENUE[c.knp]);

const wbS = XLSX.readFile(find("Продажи"));
const srows = XLSX.utils.sheet_to_json<unknown[]>(wbS.Sheets[wbS.SheetNames.find((s) => s.includes("МАЙ Поступления"))!], { header: 1, raw: false, blankrows: false }) as unknown[][];
const cleanName = (v: unknown) => String(v ?? "").split("\n")[0].replace(/ИИН.*/i, "").trim();
const sales = srows.slice(1).filter((r) => cleanName(r[2]).length > 1 && num(r[6]) > 0n)
  .map((r) => ({ company: cleanName(r[2]), project: String(r[4] ?? "").trim(), gross: num(r[6]) }));

// Матчинг: 1) точно, 2) ±1 ₸ (комиссия/копейки), 3) имя + ≤5000 ₸.
type Row = { sale: typeof sales[0]; bank: typeof clientCredits[0] | null; note: string };
const out: Row[] = [];
for (const sale of sales) {
  let b = clientCredits.find((c) => !c.used && c.amountTiyn === sale.gross);
  let note = "точное совпадение суммы";
  if (!b) { b = clientCredits.find((c) => !c.used && abs(c.amountTiyn - sale.gross) <= 100n); if (b) note = `разница ${fmt(b.amountTiyn - sale.gross)} ₸ (комиссия/копейки)`; }
  if (!b) { b = clientCredits.find((c) => !c.used && nameSim(c.counterparty, sale.company) && abs(c.amountTiyn - sale.gross) <= 500000n); if (b) note = `по имени, разница ${fmt(b.amountTiyn - sale.gross)} ₸`; }
  if (b) {
    b.used = true;
    if (note === "точное совпадение суммы" && !nameSim(b.counterparty, sale.company)) note = "сумма совпала, но имена разные — проверить";
    out.push({ sale, bank: b, note });
  } else {
    out.push({ sale, bank: null, note: FOREIGN.some((f) => sale.company.includes(f)) ? "иностранный клиент — оплата в валюте (КНП 213), привязать вручную" : "в выписке не найдено" });
  }
}

// --- Консоль ---
const matched = out.filter((r) => r.bank);
console.log(`СВЕРКА ПОСТУПЛЕНИЙ МАЙ — продажи: ${sales.length} | сматчено: ${matched.length} | не нашли: ${out.length - matched.length}\n`);
out.forEach((m, i) => {
  const tag = m.bank ? "✓" : "✗";
  console.log(`${tag} ${String(i + 1).padStart(2)} ${m.sale.company.slice(0, 30).padEnd(30)} ${fmt(m.sale.gross).padStart(13)} → ${m.bank ? m.bank.counterparty.slice(0, 26).padEnd(26) + " " + m.bank.occurredAt.toLocaleDateString("ru-RU") : "—"}  [${m.note}]`);
});
const leftover = clientCredits.filter((c) => !c.used);
console.log(`\nКредиты банка без пары (${leftover.length}):`);
leftover.forEach((c) => console.log(`  • ${c.counterparty.slice(0, 40).padEnd(40)} ${fmt(c.amountTiyn).padStart(13)} ₸  ${c.occurredAt.toLocaleDateString("ru-RU")}`));

// --- Excel-отчёт (ExcelJS, с подсветкой долларовых строк красным) ---
const isUSD = (company: string) => /alba|innovateer/i.test(company);
const RED_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFC7CE" } };
const RED_FONT = { color: { argb: "FF9C0006" } };

const wbx = new ExcelJS.Workbook();
const ws = wbx.addWorksheet("Сверка поступлений");
ws.columns = [
  { header: "№", width: 5 }, { header: "Статус", width: 12 }, { header: "Компания (отчёт)", width: 34 },
  { header: "Проект", width: 24 }, { header: "Сумма отчёт, ₸", width: 16 }, { header: "Контрагент (банк)", width: 34 },
  { header: "Сумма банк, ₸", width: 16 }, { header: "Δ, ₸", width: 10 }, { header: "Дата (банк)", width: 13 }, { header: "Примечание", width: 48 },
];
ws.getRow(1).font = { bold: true };
out.forEach((m, i) => {
  const usd = isUSD(m.sale.company);
  const row = ws.addRow([
    i + 1, usd ? "USD (валюта)" : m.bank ? "сматчено" : "НЕ НАЙДЕНО", m.sale.company, m.sale.project,
    tng(m.sale.gross), m.bank?.counterparty ?? "", m.bank ? tng(m.bank.amountTiyn) : "",
    m.bank ? tng(m.bank.amountTiyn - m.sale.gross) : "", m.bank ? m.bank.occurredAt.toLocaleDateString("ru-RU") : "",
    usd ? "Оплата в долларах — сверять с валютным зачислением Kaspi (КНП 213)" : m.note,
  ]);
  if (usd) row.eachCell((c) => { c.fill = RED_FILL; c.font = RED_FONT; });
});
["E", "G", "H"].forEach((col) => (ws.getColumn(col).numFmt = "#,##0"));

const ws2 = wbx.addWorksheet("Без пары и исключения");
ws2.addRow(["Кредиты банка без пары в отчёте продаж"]).font = { bold: true };
ws2.addRow(["Контрагент", "Сумма, ₸", "Дата", "КНП"]);
leftover.forEach((c) => ws2.addRow([c.counterparty, tng(c.amountTiyn), c.occurredAt.toLocaleDateString("ru-RU"), c.knp]));
ws2.addRow([]);
ws2.addRow(["Исключены как неклиентские (валюта/займы/возвраты)"]).font = { bold: true };
ws2.addRow(["Тип", "Контрагент", "Сумма, ₸"]);
nonRevenue.forEach((c) => ws2.addRow([KNP_NON_REVENUE[c.knp], c.counterparty, tng(c.amountTiyn)]));
ws2.getColumn("B").numFmt = "#,##0";
ws2.getColumn("A").width = 28; ws2.getColumn("B").width = 16; ws2.getColumn("C").width = 14;

const outPath = path.join(DIR, "Сверка_поступлений_май.xlsx");
wbx.xlsx
  .writeFile(outPath)
  .then(() => console.log(`\n📄 Excel-отчёт сохранён: import-samples/Сверка_поступлений_май.xlsx (долларовые — красным)`))
  .catch((e) => console.error("Ошибка записи Excel:", e.message));
