// Создаёт клиентов и проекты из листа "МАЙ Поступления" с именем "Клиент_Проект".
// Идемпотентно (по имени). npx tsx scripts/create-may-projects.ts
import * as XLSX from "xlsx";
import { readdirSync } from "fs";
import path from "path";
import { PrismaClient, ServiceType } from "@prisma/client";

const prisma = new PrismaClient();
const ENTITY = "entity_bravetalents";
const DIR = path.join(process.cwd(), "import-samples");

const clean = (v: unknown) => String(v ?? "").split("\n")[0].trim();
const serviceOf = (s: string): ServiceType => (/продакшн|креатив|видео|съём/i.test(s) ? "VIDEO_PHOTO" : "INFLUENCE");
const isJunk = (c: string, p: string) => /^(пример|май)$/i.test(c) || /^(пример|май)$/i.test(p) || c.length < 2 || p.length < 1;

async function main() {
  const f = readdirSync(DIR).find((x) => x.includes("Продажи"))!;
  const wb = XLSX.readFile(path.join(DIR, f));
  const ws = wb.Sheets[wb.SheetNames.find((s) => s.includes("МАЙ Поступления"))!];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, blankrows: false }) as unknown[][];

  const cost7366 = await prisma.ledger.findFirstOrThrow({ where: { entityId: ENTITY, kind: "COST_7366" } });

  // Уникальные (клиент, проект); дубли мерджим по ключу без пробелов/регистра.
  const seen = new Set<string>();
  const items: { company: string; project: string; service: string }[] = [];
  for (const r of rows.slice(1)) {
    const company = clean(r[2]), project = clean(r[4]), service = clean(r[3]);
    if (isJunk(company, project)) continue;
    const key = (company + project).toLowerCase().replace(/\s/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ company, project, service });
  }

  let createdClients = 0, createdProjects = 0;
  const clientId = new Map<string, string>();
  for (const it of items) {
    let cid = clientId.get(it.company);
    if (!cid) {
      let client = await prisma.client.findFirst({ where: { entityId: ENTITY, name: it.company } });
      if (!client) { client = await prisma.client.create({ data: { entityId: ENTITY, name: it.company } }); createdClients++; }
      cid = client.id; clientId.set(it.company, cid);
    }
    const name = `${it.company}_${it.project}`;
    const exists = await prisma.project.findFirst({ where: { entityId: ENTITY, name } });
    if (!exists) {
      const maxNo = (await prisma.project.aggregate({ where: { entityId: ENTITY }, _max: { number: true } }))._max.number ?? 0;
      await prisma.project.create({ data: { entityId: ENTITY, number: maxNo + 1, ledgerId: cost7366.id, clientId: cid, name, serviceType: serviceOf(it.service) } });
      createdProjects++;
    }
  }

  console.log(`Готово. Клиентов создано: ${createdClients} | Проектов создано: ${createdProjects} | Всего уникальных проектов в мае: ${items.length}`);
  console.log("\nСписок проектов:");
  items.forEach((it, i) => console.log(`${String(i + 1).padStart(2)}. [${serviceOf(it.service) === "VIDEO_PHOTO" ? "Video/Photo" : "Influence"}] ${it.company}_${it.project}`));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
