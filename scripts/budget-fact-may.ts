// Авто-привязка факта майского бюджета 6890: реестр 6890 (май) → статьи бюджета
// по ключевым словам. Записывает actualAmount. npx tsx scripts/budget-fact-may.ts
import * as XLSX from "xlsx";
import path from "path";
import { readdirSync } from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ENTITY = "entity_bravetalents";
const DIR = path.join(process.cwd(), "import-samples");
const find = (s: string) => path.join(DIR, readdirSync(DIR).find((x) => x.toLowerCase().includes(s.toLowerCase()))!);
const fmt = (t: bigint) => (Number(t) / 100).toLocaleString("ru-RU") + " ₸";
const num = (v: unknown): bigint => {
  if (v == null || v === "") return 0n;
  const s = String(v).replace(/[\s₸,]/g, "").replace(/[^\d.\-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s) || s === "-") return 0n;
  const [i, f = ""] = s.replace("-", "").split(".");
  return BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
};

// Исключения: строки, НЕ относящиеся к бэк-офису (личное/дивиденды Алмаса,
// отдельный юнит «Брэйв ИИ», зарплата/налоги/займы/подотчёт).
const EXCLUDE = ["алмас", "брэйв ии", "brave ии", "возврат займ", "возврат сумм", "зарплата за", "аванс за", "аванс санж", "аванс гул", "отпускн", "гпх", "налог", "подотчет", "опв", "пенсионн", "бонус", "авиабилет"];

// Карта: статья → ключевые слова (в порядке приоритета; специфичные — выше).
const KEYWORDS: [string, string[]][] = [
  ["Подарки блогерам", ["подарок блогер", "подарки блогер", "блогер подар"]],
  ["Подарки клиентам", ["подарок клиент", "подарки клиент"]],
  ["ИИ-подписки", ["расходы ии", "openai", "chatgpt", "нейросет", "midjourney", "claude", "перплекс", "perplexity"]],
  ["CRM / виджеты", ["crm", "виджет", "amocrm", "bitrix", "битрикс"]],
  ["Google Suite", ["google", "гугл", "workspace", "g suite"]],
  ["Яндекс", ["яндекс", "yandex"]],
  ["Аренда офиса", ["аренд"]],
  ["Комуналка", ["комун", "коммунал", "ком услуг", "комуслуг", "электроэнерг", "энергоснаб", "теплоснаб"]],
  ["Телефон (корп. связь)", ["мобильн", "корп связ", "сотов связ", "корпоративн связ"]],
  ["Интернет", ["интернет", "казахтелеком", "transtelecom", "транстелеком", "jusan mobile"]],
  ["Заправка картриджей", ["картридж", "заправк тонер", "тонер"]],
  ["Канцтовары", ["канцтовар", "канцеляр"]],
  ["Кофе (капсулы)", ["кофе", "капсул", "nespresso", "неспрессо"]],
  ["Вода", ["вода ", "артезиан", "тазалык су"]],
  ["Аптечка", ["аптечк", "аптек"]],
  ["Торты на ДР", ["торт"]],
  ["ГСМ", ["гсм", "бензин", "топлив", " азс"]],
  ["Флорист", ["флорист", "цвет"]],
  ["Клининг ежеквартальный", ["клининг", "уборк помещ"]],
  ["Расходы HR", ["hh.kz", "headhunter", "хедхантер", "рекрут", "подбор персонал"]],
  ["Комиссия банка", ["комисси банк", "банковск комисс", "комисси за"]],
  ["Доставки", ["доставк", "курьер"]],
  ["Узбекские расходы", ["узбек", "ташкент"]],
  ["Встречи с клиентами", ["встреч с клиент", "ужин", "ресторан", "бизнес-ланч"]],
  ["Подписки на сервисы", ["подписк", "subscription", "wazzup", "лицензи"]],
  ["ЗП техперсонала", ["техперсонал", "уборщиц"]],
  ["Расходы на проверку и перевод", ["нотариус", "перевод документ", "апостил"]],
];

interface Row { supplier: string; project: string; desc: string; amount: bigint }
function parseReestr6890(): Row[] {
  const wb = XLSX.readFile(find("Реестр"));
  const out: Row[] = [];
  for (const t of wb.SheetNames.filter((s) => s.includes(".05"))) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[t], { header: 1, raw: false, blankrows: false }) as unknown[][];
    const hIdx = rows.findIndex((r) => r.some((c) => /наименование поставщика/i.test(String(c ?? ""))));
    if (hIdx < 0) continue;
    const header = rows[hIdx];
    const accIdx = header.findIndex((c) => /сч[её]т/i.test(String(c ?? "")));
    const respIdx = header.findIndex((c) => /ответствен/i.test(String(c ?? "")));
    const dayEnd = respIdx > accIdx ? respIdx : header.length;
    for (const r of rows.slice(hIdx + 1)) {
      if (!String(r[accIdx] ?? "").replace(/\s/g, "").includes("6890")) continue;
      let amount = 0n;
      for (let c = accIdx + 1; c < dayEnd; c++) amount += num(r[c]);
      if (amount <= 0n) continue;
      out.push({ supplier: String(r[1] ?? "").split("\n")[0].trim(), project: String(r[2] ?? "").trim(), desc: String(r[3] ?? "").trim(), amount });
    }
  }
  return out;
}

async function main() {
  const period = await prisma.budgetPeriod.findFirstOrThrow({ where: { entityId: ENTITY, year: 2026, month: 5 } });
  await prisma.budgetLine.updateMany({ where: { periodId: period.id }, data: { actualAmount: 0n } });

  const rows = parseReestr6890();
  const factByArticle = new Map<string, bigint>();
  const unmatched: Row[] = [];

  let excluded = 0;
  let excludedAmt = 0n;
  for (const row of rows) {
    const text = `${row.supplier} ${row.project} ${row.desc}`.toLowerCase();
    if (EXCLUDE.some((e) => text.includes(e))) { excluded++; excludedAmt += row.amount; continue; } // не бэк-офис
    const hit = KEYWORDS.find(([, kws]) => kws.some((k) => text.includes(k)));
    if (hit) factByArticle.set(hit[0], (factByArticle.get(hit[0]) ?? 0n) + row.amount);
    else unmatched.push(row);
  }
  console.log(`Исключено как не-бэк-офис (Алмас/Брэйв ИИ/займы/ЗП/налоги/подотчёт): ${excluded} на ${fmt(excludedAmt)}`);

  // Записываем факт по статьям.
  for (const [title, amount] of factByArticle) {
    await prisma.budgetLine.updateMany({ where: { periodId: period.id, title }, data: { actualAmount: amount } });
  }

  const matchedTotal = [...factByArticle.values()].reduce((s, v) => s + v, 0n);
  console.log(`Реестр 6890 (май): ${rows.length} строк | сопоставлено со статьями: ${rows.length - unmatched.length} на ${fmt(matchedTotal)}\n`);
  console.log("Факт по статьям:");
  [...factByArticle.entries()].sort((a, b) => Number(b[1] - a[1])).forEach(([t, v]) => console.log(`  ${t.padEnd(34)} ${fmt(v).padStart(16)}`));
  console.log(`\nНе привязано к статьям (${unmatched.length}) — топ (вкл. зарплату/налоги/проекты, не относящиеся к бэк-офису):`);
  unmatched.sort((a, b) => Number(b.amount - a.amount)).slice(0, 15).forEach((r) => console.log(`  • ${(r.supplier || r.project || r.desc).slice(0, 34).padEnd(34)} ${fmt(r.amount).padStart(16)}  [${r.project}/${r.desc}]`.slice(0, 110)));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
