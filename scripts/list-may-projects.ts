import * as XLSX from "xlsx";
import { readdirSync } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "import-samples");
const f = readdirSync(DIR).find((x) => x.includes("Продажи"))!;
const wb = XLSX.readFile(path.join(DIR, f));
const ws = wb.Sheets[wb.SheetNames.find((s) => s.includes("МАЙ Поступления"))!];
const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, blankrows: false }) as unknown[][];
const clean = (v: unknown) => String(v ?? "").split("\n")[0].trim();

// Колонки: 2 компания, 3 вид услуги, 4 проект, 6 сумма с НДС.
const data = rows.slice(1).filter((r) => clean(r[2]).length > 1 && clean(r[4]).length > 0);

const services = new Map<string, number>();
data.forEach((r) => services.set(clean(r[3]), (services.get(clean(r[3])) ?? 0) + 1));
console.log("=== Виды услуг (как в отчёте) ===");
[...services].forEach(([s, n]) => console.log(`  "${s}": ${n}`));

// Уникальные (клиент, проект).
const uniq = new Map<string, { company: string; service: string; project: string }>();
data.forEach((r) => {
  const key = `${clean(r[2])}__${clean(r[4])}`;
  if (!uniq.has(key)) uniq.set(key, { company: clean(r[2]), service: clean(r[3]), project: clean(r[4]) });
});
console.log(`\n=== Уникальные проекты: ${uniq.size} (из ${data.length} строк) ===`);
[...uniq.values()].forEach((p, i) => console.log(`${String(i + 1).padStart(2)}. [${p.service}] ${p.company}_${p.project}`));
