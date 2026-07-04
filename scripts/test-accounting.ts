// Тест финансового движка: разнесение поступлений по смете + выплаты.
// Проверяет точность в тиынах и сходимость балансов. npx tsx test-accounting.ts
import { PrismaClient } from "@prisma/client";
import { postIncomingAllocation } from "@/lib/accounting/posting";
import { markPaid } from "@/lib/treasury/service";
import { saveEstimateVersion } from "@/lib/estimates/service";
import { accountBalanceByCode, projectBalance } from "@/lib/accounting/balances";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function eq(a: bigint, b: bigint, label: string) {
  const ok = a === b;
  console.log(`${ok ? "✓" : "✗ ПРОВАЛ:"} ${label}  (${a}${ok ? "" : " ≠ " + b})`);
  ok ? pass++ : fail++;
}

async function authUser(email: string) {
  const u = await prisma.user.findUnique({ where: { email }, include: { roles: true } });
  return { id: u!.id, email: u!.email, fullName: u!.fullName, entityId: u!.entityId, departmentId: u!.departmentId, roles: u!.roles.map((r) => r.role) };
}

async function main() {
  const E = "entity_bravetalents";
  // Чистим транзакционные данные (демо-справочники не трогаем).
  await prisma.transaction.deleteMany({ where: { entityId: E } });
  await prisma.allocation.deleteMany({});
  await prisma.incoming.deleteMany({ where: { entityId: E } });

  const cfo = await authUser("sanzhar.assylbek@bravetalents.com");
  const accountant = await authUser("symbat.otesh@bravetalents.com");

  // Нормализация: свежая версия сметы под ТЕКУЩУЮ ставку НДС (vatFromGross),
  // чтобы тест не зависел от версии, оставшейся в БД от прошлых запусков.
  await saveEstimateVersion(cfo, "demo_project_nauryz", {
    clientPriceGrossTiyn: 100_000_000n,
    depositTiyn: 0n,
    lines: [
      { title: "Блогер Айбек", amountTiyn: 35_000_000n, isCategory: false },
      { title: "Блогер Динара", amountTiyn: 25_000_000n, isCategory: false },
    ],
    reason: "OTHER",
    comment: "[TEST] нормализация под текущую ставку НДС",
  });

  // Смета Наурыз: gross 100 000 000, НДС 13 793 103 (16/116), себест. 60 000 000, маржа 26 206 897.

  // 1. Полная оплата
  const inc1 = await prisma.incoming.create({ data: { entityId: E, amount: 100_000_000n, receivedAt: new Date("2026-06-01"), projectId: "demo_project_nauryz", status: "UNALLOCATED" } });
  const a1 = await postIncomingAllocation(cfo, inc1.id);
  eq(a1.vatAmount, 13_793_103n, "полная оплата: НДС");
  eq(a1.costAmount, 60_000_000n, "полная оплата: себестоимость");
  eq(a1.marginAmount, 26_206_897n, "полная оплата: маржа");
  eq(a1.vatAmount + a1.costAmount + a1.marginAmount, 100_000_000n, "части сходятся к поступлению");

  eq(await accountBalanceByCode(E, "6890"), 26_206_897n, "остаток 6890 = маржа");
  eq(await accountBalanceByCode(E, "3098"), 13_793_103n, "остаток 3098 = НДС");
  eq(await accountBalanceByCode(E, "7366"), 60_000_000n, "остаток 7366 = себестоимость");
  eq(await projectBalance("demo_project_nauryz"), 60_000_000n, "баланс проекта = себестоимость");

  // 2. Частичная оплата 50%
  const inc2 = await prisma.incoming.create({ data: { entityId: E, amount: 50_000_000n, receivedAt: new Date("2026-06-05"), projectId: "demo_project_nauryz", status: "UNALLOCATED" } });
  const a2 = await postIncomingAllocation(cfo, inc2.id);
  eq(a2.vatAmount, 6_896_551n, "50%: НДС пропорционально");
  eq(a2.costAmount, 30_000_000n, "50%: себестоимость пропорционально");
  eq(a2.marginAmount, 13_103_449n, "50%: маржа (с остатком округления)");
  eq(a2.vatAmount + a2.costAmount + a2.marginAmount, 50_000_000n, "50%: части сходятся");

  // 3. Выплата получателю (35 000 000) → баланс проекта уменьшается
  const req = await prisma.paymentRequest.create({
    data: { entityId: E, number: "PAYTEST-1", expenseTypeId: (await prisma.expenseType.findFirstOrThrow({ where: { code: "BLOGGER_FEE" } })).id, status: "IN_REGISTER", createdById: cfo.id, projectId: "demo_project_nauryz", recipientId: "demo_recipient_aibek", amount: 35_000_000n, purpose: "[PAYTEST] выплата", urgency: "MEDIUM" },
  });
  await markPaid(accountant, req.id, new Date("2026-06-10"));
  eq(await projectBalance("demo_project_nauryz"), 90_000_000n - 35_000_000n, "баланс проекта после выплаты");
  eq((await prisma.paymentRequest.findUnique({ where: { id: req.id } }))!.status === "PAID" ? 1n : 0n, 1n, "заявка стала PAID");

  // 4. Сходимость: сумма ВСЕХ транзакций = поступления − выплаты
  const all = await prisma.transaction.aggregate({ where: { entityId: E }, _sum: { amount: true } });
  eq(all._sum.amount ?? 0n, 150_000_000n - 35_000_000n, "сходимость: сумма всех транзакций = приток − отток");

  // 5. Защита от двойного разнесения: повторный вызов НЕ создаёт дублей.
  let doubleAllocBlocked = 0n;
  try {
    await postIncomingAllocation(cfo, inc1.id);
  } catch {
    doubleAllocBlocked = 1n;
  }
  eq(doubleAllocBlocked, 1n, "повторное разнесение отклонено");
  const allocCount = await prisma.allocation.count({ where: { incomingId: inc1.id } });
  eq(BigInt(allocCount), 1n, "разнесение одно (нет дубля Allocation)");
  eq(await accountBalanceByCode(E, "6890"), 26_206_897n + 13_103_449n, "остаток 6890 не задвоился");

  // 6. Защита от двойной оплаты: повторный markPaid отклонён, PAYOUT один.
  let doublePaidBlocked = 0n;
  try {
    await markPaid(accountant, req.id, new Date("2026-06-11"));
  } catch {
    doublePaidBlocked = 1n;
  }
  eq(doublePaidBlocked, 1n, "повторная отметка «оплачено» отклонена");
  const payoutCount = await prisma.transaction.count({ where: { paymentRequestId: req.id, kind: "PAYOUT" } });
  eq(BigInt(payoutCount), 1n, "выплата одна (нет дубля PAYOUT)");
  eq(await projectBalance("demo_project_nauryz"), 90_000_000n - 35_000_000n, "баланс проекта не задвоился");

  // 7. Ревизия сметы (DECISIONS §1.1): себестоимость 600k → 500k,
  //    уже разнесённые поступления пере-разносятся ADJUSTMENT-проводками.
  await saveEstimateVersion(cfo, "demo_project_nauryz", {
    clientPriceGrossTiyn: 100_000_000n,
    depositTiyn: 0n,
    lines: [
      { title: "Блогер Айбек", amountTiyn: 30_000_000n, isCategory: false },
      { title: "Блогер Динара", amountTiyn: 20_000_000n, isCategory: false },
    ],
    reason: "PROJECT_REDUCED",
    comment: "[TEST] сокращение",
  });
  // Новая себестоимость: полная оплата → 50M, 50% → 25M. Итого на 7366: 75M − 35M выплата.
  eq(await accountBalanceByCode(E, "7366"), 75_000_000n - 35_000_000n, "пересчёт: 7366 по новой смете");
  eq(await accountBalanceByCode(E, "3098"), 13_793_103n + 6_896_551n, "пересчёт: НДС не изменился");
  eq(await accountBalanceByCode(E, "6890"), 36_206_897n + 18_103_449n, "пересчёт: маржа выросла на дельту себестоимости");
  const total2 = await prisma.transaction.aggregate({ where: { entityId: E }, _sum: { amount: true } });
  eq(total2._sum.amount ?? 0n, 150_000_000n - 35_000_000n, "пересчёт: общая сумма не изменилась (дельты в ноль)");

  // Возвращаем демо-смету к исходной (v3), чтобы dev-данные не «плыли» от тестов.
  await saveEstimateVersion(cfo, "demo_project_nauryz", {
    clientPriceGrossTiyn: 100_000_000n,
    depositTiyn: 0n,
    lines: [
      { title: "Блогер Айбек", amountTiyn: 35_000_000n, isCategory: false },
      { title: "Блогер Динара", amountTiyn: 25_000_000n, isCategory: false },
    ],
    reason: "OTHER",
    comment: "[TEST] возврат к исходной",
  });

  // Чистим тестовое
  await prisma.transaction.deleteMany({ where: { entityId: E } });
  await prisma.allocation.deleteMany({});
  await prisma.incoming.deleteMany({ where: { entityId: E } });
  await prisma.paymentRequest.deleteMany({ where: { number: "PAYTEST-1" } });

  console.log(`\nИТОГО: ${pass} прошло, ${fail} провалено`);
}

main().catch((e) => { console.error(e); fail++; }).finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
