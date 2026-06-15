import * as XLSX from "xlsx";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parseKaspiStatement, KNP_INTERNAL_TRANSFER } from "@/lib/import/kaspi";

const DIR = path.join(process.cwd(), "import-samples");
const files = readdirSync(DIR).filter((f) => f.endsWith(".xlsx"));
const find = (s: string) => path.join(DIR, files.find((x) => x.toLowerCase().includes(s.toLowerCase()))!);
const fmt = (t: bigint) => (Number(t) / 100).toLocaleString("ru-RU") + " ₸";
const num = (v: unknown): bigint => {
  if (v == null || v === "") return 0n;
  const s = String(v).replace(/[\s₸,]/g, "").replace(/[^\d.\-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0n;
  const [i, f = ""] = s.replace("-", "").split(".");
  return BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
};
const norm = (s: string) => s.toLowerCase().replace(/(тоо|ип|ооо|чк|ао|"|«|»)/g, "").replace(/[^a-zа-я0-9]/gi, "");
const nameSim = (a: string, b: string) => { const x = norm(a), y = norm(b); if (x.length < 4 || y.length < 4) return false; const [s, l] = x.length < y.length ? [x, y] : [y, x]; return l.includes(s.slice(0, Math.min(10, s.length))); };
const absB = (n: bigint) => (n < 0n ? -n : n);

interface Exp { supplier: string; project: string; amount: bigint; sheet: string }

// Парсер листа реестра: авто-определение колонок счёта/ответственных/сумм.
function parseReestr(ws: XLSX.WorkSheet, sheet: string): Exp[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, blankrows: false }) as unknown[][];
  const hIdx = rows.findIndex((r) => r.some((c) => /наименование поставщика/i.test(String(c ?? ""))) || r.some((c) => /^счет$/i.test(String(c ?? "").trim())));
  if (hIdx < 0) return [];
  const header = rows[hIdx];
  const accIdx = header.findIndex((c) => /сч[её]т/i.test(String(c ?? "")));
  const respIdx = header.findIndex((c) => /ответствен/i.test(String(c ?? "")));
  const supIdx = Math.max(0, header.findIndex((c) => /поставщик/i.test(String(c ?? ""))));
  const projIdx = header.findIndex((c) => /проект/i.test(String(c ?? "")));
  if (accIdx < 0) return [];
  const dayEnd = respIdx > accIdx ? respIdx : header.length;

  const out: Exp[] = [];
  for (const r of rows.slice(hIdx + 1)) {
    const acc = String(r[accIdx] ?? "").replace(/\s/g, "");
    if (!acc.includes("6890")) continue;
    let amount = 0n;
    for (let c = accIdx + 1; c < dayEnd; c++) amount += num(r[c]);
    if (amount <= 0n) continue;
    out.push({ supplier: String(r[supIdx] ?? "").split("\n")[0].trim(), project: projIdx >= 0 ? String(r[projIdx] ?? "").trim() : "", amount, sheet });
  }
  return out;
}

// --- Реестр: майские листы (с ".05"), счёт 6890 ---
const wbR = XLSX.readFile(find("Реестр"));
const mayTabs = wbR.SheetNames.filter((s) => s.includes(".05"));
let expenses: Exp[] = [];
for (const t of mayTabs) expenses = expenses.concat(parseReestr(wbR.Sheets[t], t));
const expTotal = expenses.reduce((s, e) => s + e.amount, 0n);
console.log(`Майские листы реестра (с ".05"): ${mayTabs.join(", ")}`);
console.log(`Расходов со счётом 6890: ${expenses.length} на ${fmt(expTotal)}\n`);

// --- Банк: дебеты 6890 (списания), без внутренних переводов ---
const bankDebits = parseKaspiStatement(readFileSync(find("6890"))).lines
  .filter((l) => l.direction === "DEBIT" && l.knp !== KNP_INTERNAL_TRANSFER)
  .map((l) => ({ ...l, used: false }));
const debTotal = bankDebits.reduce((s, l) => s + l.amountTiyn, 0n);
console.log(`Дебеты банка 6890 (без переводов): ${bankDebits.length} на ${fmt(debTotal)}\n`);

// --- Матчинг реестр → банк ---
let matched = 0, matchedAmt = 0n;
const unmatched: Exp[] = [];
for (const e of expenses) {
  let b = bankDebits.find((d) => !d.used && d.amountTiyn === e.amount);
  if (!b) b = bankDebits.find((d) => !d.used && absB(d.amountTiyn - e.amount) <= 100n);
  if (!b) b = bankDebits.find((d) => !d.used && nameSim(d.counterparty, e.supplier) && absB(d.amountTiyn - e.amount) <= 500000n);
  if (b) { b.used = true; matched++; matchedAmt += e.amount; } else unmatched.push(e);
}
console.log(`=== СВЕРКА РАСХОДОВ 6890: реестр ↔ банк ===`);
console.log(`Сматчено: ${matched}/${expenses.length} на ${fmt(matchedAmt)}`);
console.log(`\nВ реестре, но НЕ найдено списание в банке (${unmatched.length}):`);
unmatched.slice(0, 20).forEach((e) => console.log(`  • ${e.supplier.slice(0, 34).padEnd(34)} ${fmt(e.amount).padStart(14)}  [${e.sheet.trim()}] ${e.project}`));
const leftover = bankDebits.filter((d) => !d.used);

// --- Свёртка зарплаты и налогов (реестр = одна строка, банк = много платежей) ---
const isSalary = (knp: string, name: string) => knp === "332" || /зарплат|аванс|отпускн|гпх|kaspi bank/i.test(name);
const isTax = (knp: string, name: string) => ["911", "010", "011", "012", "013", "019", "089", "121", "122"].includes(knp) || /госкорпораци|угд|комитет госдоход|енпф|пенси|налог/i.test(name);

const bankSalary = leftover.filter((d) => isSalary(d.knp, d.counterparty)).reduce((s, d) => s + d.amountTiyn, 0n);
const bankTax = leftover.filter((d) => isTax(d.knp, d.counterparty) && !isSalary(d.knp, d.counterparty)).reduce((s, d) => s + d.amountTiyn, 0n);
const bankOther = leftover.filter((d) => !isSalary(d.knp, d.counterparty) && !isTax(d.knp, d.counterparty)).reduce((s, d) => s + d.amountTiyn, 0n);

const regSalary = unmatched.filter((e) => /зарплат|аванс|отпускн|гпх/i.test(e.supplier)).reduce((s, e) => s + e.amount, 0n);
const regTax = unmatched.filter((e) => /налог/i.test(e.supplier)).reduce((s, e) => s + e.amount, 0n);
const regOther = unmatched.filter((e) => !/зарплат|аванс|отпускн|гпх|налог/i.test(e.supplier)).reduce((s, e) => s + e.amount, 0n);

console.log(`\n=== СВЁРТКА несматченного (реестр-строка ↔ итог банка) ===`);
console.log(`Зарплата: реестр ${fmt(regSalary).padStart(16)} | банк (КНП 332 и пр.) ${fmt(bankSalary)}  Δ ${fmt(regSalary - bankSalary)}`);
console.log(`Налоги:   реестр ${fmt(regTax).padStart(16)} | банк (Госкорп/УГД)    ${fmt(bankTax)}  Δ ${fmt(regTax - bankTax)}`);
console.log(`Прочее:   реестр ${fmt(regOther).padStart(16)} | банк прочее            ${fmt(bankOther)}`);

console.log(`\nСписания банка без пары — прочее (не зарплата/налоги), топ:`);
leftover.filter((d) => !isSalary(d.knp, d.counterparty) && !isTax(d.knp, d.counterparty)).sort((a, b) => Number(b.amountTiyn - a.amountTiyn)).slice(0, 12).forEach((d) => console.log(`  • ${d.counterparty.slice(0, 34).padEnd(34)} ${fmt(d.amountTiyn).padStart(14)}  ${d.occurredAt.toLocaleDateString("ru-RU")} КНП ${d.knp}`));
