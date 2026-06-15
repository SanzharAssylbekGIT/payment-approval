// Загружает статьи бюджета бэк-офиса из "Бюджет бэк офис.xlsx" как план
// помесячного бюджета 6890 на май 2026. npx tsx scripts/seed-budget-may.ts
import * as XLSX from "xlsx";
import path from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ENTITY = "entity_bravetalents";

const num = (v: unknown): bigint => {
  if (v == null || v === "") return 0n;
  const s = String(v).replace(/[\s₸,]/g, "").replace(/[^\d.\-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s) || s === "-") return 0n;
  const [i, f = ""] = s.replace("-", "").split(".");
  return BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
};

async function main() {
  const wb = XLSX.readFile(path.join(process.cwd(), "import-samples", "Бюджет бэк офис.xlsx"));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Sheet1"], { header: 1, raw: false, blankrows: false }) as unknown[][];

  // Статьи: строка с названием в col0; пропускаем секцию "Офисные" и "Итого".
  const articles = rows
    .map((r) => ({ title: String(r[0] ?? "").trim(), amount: num(r[1]) }))
    .filter((a) => a.title && !/^офисные$/i.test(a.title) && !/^итого/i.test(a.title));

  // Период: май 2026 (month = 5).
  let period = await prisma.budgetPeriod.findFirst({ where: { entityId: ENTITY, year: 2026, month: 5 } });
  if (!period) period = await prisma.budgetPeriod.create({ data: { entityId: ENTITY, year: 2026, month: 5 } });
  await prisma.budgetLine.deleteMany({ where: { periodId: period.id } });
  for (const a of articles) await prisma.budgetLine.create({ data: { periodId: period.id, title: a.title, plannedAmount: a.amount } });

  const total = articles.reduce((s, a) => s + a.amount, 0n);
  console.log(`Загружено статей: ${articles.length} | план итого: ${(Number(total) / 100).toLocaleString("ru-RU")} ₸ (период май 2026)`);
  articles.forEach((a) => console.log(`  ${a.title.padEnd(34)} ${(Number(a.amount) / 100).toLocaleString("ru-RU").padStart(14)}`));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
