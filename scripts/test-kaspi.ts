import { readFileSync, readdirSync } from "fs";
import path from "path";
import { parseKaspiStatement, KNP_INTERNAL_TRANSFER } from "@/lib/import/kaspi";

const DIR = path.join(process.cwd(), "import-samples");
const files = readdirSync(DIR).filter((f) => f.endsWith(".xlsx"));
const fmt = (t: bigint) => (Number(t) / 100).toLocaleString("ru-RU") + " ₸";

for (const sub of ["6890", "7366"]) {
  const file = files.find((f) => f.includes(sub))!;
  const st = parseKaspiStatement(readFileSync(path.join(DIR, file)));
  const credits = st.lines.filter((l) => l.direction === "CREDIT").reduce((s, l) => s + l.amountTiyn, 0n);
  const debits = st.lines.filter((l) => l.direction === "DEBIT").reduce((s, l) => s + l.amountTiyn, 0n);
  const computed = (st.openingBalanceTiyn ?? 0n) + credits - debits;
  const ok = st.closingBalanceTiyn != null && computed === st.closingBalanceTiyn;

  console.log(`\n=== ${file} ===`);
  console.log(`Счёт: ${st.accountCode} (${st.accountNumber}) | период: ${st.periodFrom} – ${st.periodTo}`);
  console.log(`Операций: ${st.lines.length} | кредиты: ${fmt(credits)} | дебеты: ${fmt(debits)}`);
  console.log(`Вх. остаток: ${fmt(st.openingBalanceTiyn ?? 0n)}`);
  console.log(`Расчёт (вх + кред − деб): ${fmt(computed)}`);
  console.log(`Исх. остаток (из файла): ${fmt(st.closingBalanceTiyn ?? 0n)}`);
  console.log(ok ? "✓ БАЛАНС СХОДИТСЯ — парсер корректен" : "✗ РАСХОЖДЕНИЕ: " + fmt(computed - (st.closingBalanceTiyn ?? 0n)));
  const transfers = st.lines.filter((l) => l.knp === KNP_INTERNAL_TRANSFER);
  console.log(`Внутренних переводов (КНП 342): ${transfers.length} на ${fmt(transfers.reduce((s, l) => s + l.amountTiyn, 0n))}`);
}
