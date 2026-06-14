import * as XLSX from "xlsx";
import { readdirSync } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "import-samples");
const files = readdirSync(DIR).filter((f) => f.endsWith(".xlsx"));
const find = (sub: string) => path.join(DIR, files.find((x) => x.toLowerCase().includes(sub.toLowerCase()))!);

const num = (v: unknown): number => {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/[\s₸,]/g, "").replace(/[^\d.\-]/g, "");
  return s ? Math.round(parseFloat(s) * 100) : 0;
};
const fmt = (t: number) => (t / 100).toLocaleString("ru-RU") + " ₸";
const dayKey = (v: unknown): string => {
  const m = String(v ?? "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
// Чистим имя контрагента: первая строка, без "ИИН/БИН ..." хвоста.
const cleanName = (v: unknown) => String(v ?? "").split("\n")[0].replace(/ИИН.*/i, "").trim();
// Нормализация для сравнения имён: только буквы/цифры в нижнем регистре.
const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]/gi, "");
const nameMatch = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  const short = x.length < y.length ? x : y, long = x.length < y.length ? y : x;
  return short.length >= 4 && long.includes(short.slice(0, Math.min(10, short.length)));
};

function parseStatement(fileSub: string) {
  const ws = XLSX.readFile(find(fileSub)).Sheets["Восстановл_Лист1"];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, blankrows: false }) as unknown[][];
  const h = rows.findIndex((r) => r.some((c) => String(c).includes("Дебет")));
  return rows.slice(h + 2)
    .filter((r) => dayKey(r[1]) && (num(r[2]) || num(r[3]))) // только строки с реальной датой операции
    .map((r) => ({ date: dayKey(r[1]), debit: num(r[2]), credit: num(r[3]), name: cleanName(r[4]), knp: String(r[7] ?? "").trim(), purpose: String(r[8] ?? "").slice(0, 36) }));
}

const stmt = [...parseStatement("6890"), ...parseStatement("7366")];
const credits = stmt.filter((t) => t.credit > 0 && t.knp !== "342");
// Категории неклиентских кредитов.
const KNP_NONREVENUE: Record<string, string> = { "213": "продажа валюты", "411": "займы", "880": "возвраты", "352": "проценты банка" };
const clientCredits = credits.filter((c) => !KNP_NONREVENUE[c.knp]);
const nonRevenue = credits.filter((c) => KNP_NONREVENUE[c.knp]);

// Продажи → МАЙ (ручной разнос), без итоговых строк (пустая компания).
const wbS = XLSX.readFile(find("Продажи"));
const sheetName = wbS.SheetNames.find((s) => s.includes("МАЙ Поступления"))!;
const srows = XLSX.utils.sheet_to_json<unknown[]>(wbS.Sheets[sheetName], { header: 1, raw: false, blankrows: false }) as unknown[][];
const sales = srows.slice(1)
  .filter((r) => cleanName(r[2]).length > 1 && num(r[6]) > 0)
  .map((r) => ({ company: cleanName(r[2]), project: String(r[4] ?? "").trim(), gross: num(r[6]), vat: num(r[9]), cost: num(r[8]), margin: num(r[12]), date: dayKey(r[14]) }));

console.log(`Выписки: ${stmt.length} операций | клиентские кредиты: ${clientCredits.length} | неклиентские (валюта/займы/возвраты): ${nonRevenue.length}`);
console.log(`Продажи МАЙ (без итогов): ${sales.length} строк на ${fmt(sales.reduce((s, x) => s + x.gross, 0))}`);

// Матчинг: проход 1 — точная сумма; проход 2 — близкая сумма (±2000 ₸) + похожее имя.
const used = new Set<number>();
let exact = 0, fuzzy = 0;
const unmatched: typeof sales = [];
for (const sale of sales) {
  let idx = clientCredits.findIndex((c, i) => !used.has(i) && Math.abs(c.credit - sale.gross) <= 100);
  if (idx >= 0) { used.add(idx); exact++; continue; }
  idx = clientCredits.findIndex((c, i) => !used.has(i) && Math.abs(c.credit - sale.gross) <= 200000 && nameMatch(c.name, sale.company));
  if (idx >= 0) { used.add(idx); fuzzy++; continue; }
  unmatched.push(sale);
}
const matchedAmt = sales.filter((s) => !unmatched.includes(s)).reduce((a, s) => a + s.gross, 0);

console.log(`\n=== СВЕРКА ПОСТУПЛЕНИЙ (выписка ↔ ручной разнос) ===`);
console.log(`Сматчено: ${exact + fuzzy}/${sales.length} (точно ${exact}, по имени+сумме ${fuzzy}) на ${fmt(matchedAmt)}`);
console.log(`\nНе нашли в выписке (${unmatched.length}):`);
unmatched.forEach((s) => console.log(`  • ${s.company} / ${s.project} — ${fmt(s.gross)} ${s.date ? "(" + s.date + ")" : "(без даты)"}`));
const leftover = clientCredits.filter((_, i) => !used.has(i));
console.log(`\nКлиентские кредиты без пары в продажах (${leftover.length}):`);
leftover.forEach((c) => console.log(`  • ${c.name} — ${fmt(c.credit)} (${c.date}) КНП ${c.knp}`));
console.log(`\nНеклиентские кредиты (исключены из сверки выручки):`);
nonRevenue.forEach((c) => console.log(`  • ${KNP_NONREVENUE[c.knp]}: ${c.name} — ${fmt(c.credit)}`));
