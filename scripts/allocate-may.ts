// Разнос майских поступлений: смета на проект = сумма его строк продаж →
// Incoming из банка → postIncomingAllocation (пропорционально). Затем сверка по
// счетам с банком. npx tsx scripts/allocate-may.ts
import * as XLSX from "xlsx";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { parseKaspiStatement, KNP_INTERNAL_TRANSFER, KNP_NON_REVENUE } from "@/lib/import/kaspi";
import { postIncomingAllocation } from "@/lib/accounting/posting";
import { accountBalanceByCode } from "@/lib/accounting/balances";

const prisma = new PrismaClient();
const ENTITY = "entity_bravetalents";
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
const clean = (v: unknown) => String(v ?? "").split("\n")[0].replace(/ИИН.*/i, "").trim();
const norm = (s: string) => s.toLowerCase().replace(/(тоо|ип|ооо|чк|ао)/g, "").replace(/[^a-zа-я0-9]/gi, "");
const nameSim = (a: string, b: string) => { const x = norm(a), y = norm(b); if (x.length < 3 || y.length < 3) return false; const [s, l] = x.length < y.length ? [x, y] : [y, x]; return l.includes(s.slice(0, Math.min(10, s.length))); };
const absB = (n: bigint) => (n < 0n ? -n : n);
const isUSD = (c: string) => /alba|innovateer|kt&g|3d-outlet/i.test(c);

async function main() {
  const u = await prisma.user.findUniqueOrThrow({ where: { email: "sanzhar.assylbek@bravetalents.com" }, include: { roles: true } });
  const user = { id: u.id, email: u.email, fullName: u.fullName, entityId: u.entityId, departmentId: u.departmentId, roles: u.roles.map((r) => r.role) };

  // Чистый старт для майского разноса.
  await prisma.transaction.deleteMany({ where: { entityId: ENTITY } });
  await prisma.allocation.deleteMany({});
  await prisma.incoming.deleteMany({ where: { entityId: ENTITY } });
  await prisma.estimate.updateMany({ data: { currentVersionId: null } });
  await prisma.estimateVersion.deleteMany({});
  await prisma.estimate.deleteMany({});

  const parse = (sub: string, acc: string) => parseKaspiStatement(readFileSync(find(sub))).lines.filter((l) => l.direction === "CREDIT" && l.knp !== KNP_INTERNAL_TRANSFER && !KNP_NON_REVENUE[l.knp]).map((l) => ({ ...l, acc }));
  const credits = [...parse("6890", "6890"), ...parse("7366", "7366")].map((c) => ({ ...c, used: false }));

  // Проекты — поиск по нормализованному имени (игнор пробелов/регистра): в отчёте
  // встречаются варианты с лишним пробелом («Национальное промо» vs «...промо»).
  const nrm = (s: string) => s.toLowerCase().replace(/\s/g, "");
  const allProjects = await prisma.project.findMany({ where: { entityId: ENTITY } });
  const projByNorm = new Map(allProjects.map((p) => [nrm(p.name), p.id]));

  const wbS = XLSX.readFile(find("Продажи"));
  const srows = XLSX.utils.sheet_to_json<unknown[]>(wbS.Sheets[wbS.SheetNames.find((s) => s.includes("МАЙ Поступления"))!], { header: 1, raw: false, blankrows: false }) as unknown[][];
  const sales = srows.slice(1).filter((r) => clean(r[2]).length > 1 && num(r[6]) > 0n && !/^(пример|май)$/i.test(clean(r[2]))).map((r) => ({
    company: clean(r[2]), project: clean(r[4]), name: `${clean(r[2])}_${clean(r[4])}`, gross: num(r[6]), net: num(r[7]), cost: num(r[8]) + num(r[10]),
  }));

  // 1) Смета на проект = СУММА его строк продаж (ключ — нормализованное имя).
  const agg = new Map<string, { gross: bigint; net: bigint; cost: bigint }>();
  for (const s of sales) { const k = nrm(s.name); const a = agg.get(k) ?? { gross: 0n, net: 0n, cost: 0n }; a.gross += s.gross; a.net += s.net; a.cost += s.cost; agg.set(k, a); }
  for (const [key, a] of agg) {
    const projectId = projByNorm.get(key);
    if (!projectId) continue;
    const est = await prisma.estimate.create({ data: { entityId: ENTITY, projectId } });
    const ver = await prisma.estimateVersion.create({ data: { estimateId: est.id, version: 1, clientPriceGross: a.gross, clientPriceNet: a.net, vatAmount: a.gross - a.net, costAmount: a.cost, marginAmount: a.net - a.cost, createdById: user.id } });
    await prisma.estimate.update({ where: { id: est.id }, data: { currentVersionId: ver.id } });
  }

  // 2) Каждое поступление (строка продаж) → матч с банком → Incoming → разнос.
  let allocated = 0, skippedUSD = 0, noMatch = 0, noProject = 0;
  const byAcc: Record<string, bigint> = { "6890": 0n, "7366": 0n };
  for (const sale of sales) {
    if (isUSD(sale.company)) { skippedUSD++; continue; }
    const bank = credits.find((c) => !c.used && c.amountTiyn === sale.gross) ?? credits.find((c) => !c.used && absB(c.amountTiyn - sale.gross) <= 100n) ?? credits.find((c) => !c.used && nameSim(c.counterparty, sale.company) && absB(c.amountTiyn - sale.gross) <= 500000n);
    if (!bank) { noMatch++; continue; }
    const projectId = projByNorm.get(nrm(sale.name));
    if (!projectId) { noProject++; continue; }
    bank.used = true;
    const inc = await prisma.incoming.create({ data: { entityId: ENTITY, amount: bank.amountTiyn, receivedAt: bank.occurredAt, counterpartyName: bank.counterparty, projectId, status: "UNALLOCATED" } });
    await postIncomingAllocation(user, inc.id);
    allocated++;
    byAcc[bank.acc] = (byAcc[bank.acc] ?? 0n) + bank.amountTiyn;
  }

  console.log(`Разнесено: ${allocated} | пропущено USD: ${skippedUSD} | не сматчено: ${noMatch} | без проекта: ${noProject}\n`);

  // --- Сверка по счетам ---
  const bankCredit = (acc: string) => credits.filter((c) => c.acc === acc).reduce((s, c) => s + c.amountTiyn, 0n);
  console.log("=== СВЕРКА ПОСТУПЛЕНИЙ ПО СЧЕТАМ С БАНКОМ ===");
  for (const acc of ["6890", "7366"]) {
    const ours = byAcc[acc] ?? 0n, bank = bankCredit(acc);
    console.log(`Счёт ${acc}: разнесли ${fmt(ours).padStart(18)} | банк (клиентские кредиты) ${fmt(bank).padStart(18)}  ${ours === bank ? "✓ сошлось" : "Δ " + fmt(bank - ours) + " (не разнесено)"}`);
  }
  const leftover = credits.filter((c) => !c.used);
  if (leftover.length) {
    console.log(`\nНе разнесено (кредиты банка без пары в продажах) — ${leftover.length}:`);
    leftover.forEach((c) => console.log(`  • ${c.counterparty.slice(0, 40).padEnd(40)} ${fmt(c.amountTiyn).padStart(16)}  ${c.occurredAt.toLocaleDateString("ru-RU")} (${c.acc})`));
  }

  console.log(`\nОстатки по счетам ПОСЛЕ разноса (наш учёт):`);
  for (const acc of ["6890", "7366", "3098"]) console.log(`  ${acc}: ${fmt(await accountBalanceByCode(ENTITY, acc))}`);

  // Сверка движка с отчётом: суммарные НДС/себест/маржа.
  const allocs = await prisma.allocation.aggregate({ _sum: { vatAmount: true, costAmount: true, marginAmount: true } });
  const repVat = [...agg.values()].reduce((s, a) => s + (a.gross - a.net), 0n);
  console.log(`\n=== ДВИЖОК vs ОТЧЁТ (по разнесённым; маржа = на 6890) ===`);
  console.log(`НДС → 3098:    движок ${fmt(allocs._sum.vatAmount ?? 0n)}`);
  console.log(`Себестоим → 7366: движок ${fmt(allocs._sum.costAmount ?? 0n)}`);
  console.log(`Маржа (6890):  движок ${fmt(allocs._sum.marginAmount ?? 0n)}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
