import { readFileSync, readdirSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { importStatement } from "@/lib/import/service";

const prisma = new PrismaClient();
const DIR = path.join(process.cwd(), "import-samples");
const files = readdirSync(DIR).filter((f) => f.endsWith(".xlsx"));
const fmt = (t: bigint) => (Number(t) / 100).toLocaleString("ru-RU") + " ₸";

async function main() {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "sanzhar.assylbek@bravetalents.com" }, include: { roles: true } });
  const user = { id: u.id, email: u.email, fullName: u.fullName, entityId: u.entityId, departmentId: u.departmentId, roles: u.roles.map((r) => r.role) };

  // Чистим прошлые тестовые импорты.
  await prisma.bankStatementImport.deleteMany({ where: { entityId: user.entityId } });

  for (const sub of ["6890", "7366"]) {
    const file = files.find((f) => f.includes(sub))!;
    const id = await importStatement(user, file, readFileSync(path.join(DIR, file)));
    const imp = await prisma.bankStatementImport.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    const cats: Record<string, { n: number; sum: bigint }> = {};
    for (const l of imp.lines) { cats[l.category] ??= { n: 0, sum: 0n }; cats[l.category].n++; cats[l.category].sum += l.amount; }
    console.log(`\n=== ${sub}: ${imp.lines.length} операций, баланс ${imp.balanceOk ? "✓" : "✗"} ===`);
    for (const [c, v] of Object.entries(cats)) console.log(`  ${c}: ${v.n} оп. на ${fmt(v.sum)}`);
  }
  console.log("\nИмпорты сохранены — можно смотреть в /accounting/import");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
