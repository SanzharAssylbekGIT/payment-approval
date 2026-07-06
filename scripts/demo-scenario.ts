// Наполняет реалистичный сквозной сценарий через сервисный слой, чтобы экраны
// показывали живые данные. Идемпотентен. npx tsx scripts/demo-scenario.ts
import { PrismaClient } from "@prisma/client";
import { createRequestForUser, submitRequestForUser, approveStepForUser } from "@/lib/requests/service";
import { addToRegister, markPaid } from "@/lib/treasury/service";
import { postIncomingAllocation } from "@/lib/accounting/posting";
import type { AuthenticatedUser } from "@/lib/auth/types";

const prisma = new PrismaClient();
const E = "entity_bravetalents";

async function u(email: string): Promise<AuthenticatedUser> {
  const x = await prisma.user.findUnique({ where: { email }, include: { roles: true } });
  return { id: x!.id, email: x!.email, fullName: x!.fullName, entityId: x!.entityId, departmentId: x!.departmentId, roles: x!.roles.map((r) => r.role) };
}
async function etId(code: string) {
  return (await prisma.expenseType.findFirstOrThrow({ where: { code } })).id;
}

async function fullApprovePayPath(creator: AuthenticatedUser, input: Parameters<typeof createRequestForUser>[1], approvers: AuthenticatedUser[], cfo: AuthenticatedUser, accountant: AuthenticatedUser, pay: boolean) {
  const req = await createRequestForUser(creator, input);
  await submitRequestForUser(creator, req.id);
  for (const a of approvers) await approveStepForUser(a, req.id);
  await addToRegister(cfo, req.id);
  if (pay) await markPaid(accountant, req.id, new Date("2026-06-10"));
  return req;
}

async function main() {
  // Чистим транзакционные данные (справочники/смету/демо-проект не трогаем).
  await prisma.transaction.deleteMany({ where: { entityId: E } });
  await prisma.allocation.deleteMany({});
  await prisma.incoming.deleteMany({ where: { entityId: E } });
  await prisma.requestApproval.deleteMany({});
  await prisma.paymentRequest.deleteMany({ where: { entityId: E, number: { not: "REQ-0001" } } });

  const staff = await u("blogger.staff@bravetalents.com");
  const rakhima = await u("rakhima.turzhanova@bravetalents.com");
  const ainur = await u("ainur.abduvali@bravetalents.com");
  const cfo = await u("sanzhar.assylbek@bravetalents.com");
  const accountant = await u("symbat.otesh@bravetalents.com");
  const officeMgr = await u("office.manager@bravetalents.com");
  const kalamkas = await u("kalamkas.alimova@bravetalents.com");

  // 1. Поступление от клиента по «Наурыз» (полная оплата 1 000 000 ₸) + разнос.
  const inc = await prisma.incoming.create({ data: { entityId: E, amount: 100_000_000n, receivedAt: new Date("2026-06-02"), counterpartyName: "Яндекс Поиск", projectId: "demo_project_nauryz", responsibleUserId: rakhima.id, status: "UNALLOCATED" } });
  await postIncomingAllocation(cfo, inc.id);

  const bloggerFee = await etId("BLOGGER_FEE");
  const officeExp = await etId("OFFICE_EXP");

  // 2. Гонорар Айбеку 350 000 ₸ (договор 350k × 100%) — полностью проведён (оплачен).
  await fullApprovePayPath(staff, { expenseTypeId: bloggerFee, projectId: "demo_project_nauryz", recipientId: "demo_recipient_aibek", contractAmountTiyn: 35_000_000n, paymentPercent: 100, deliverables: ["STORY_SERIES"], paymentTiming: "POSTPAY", urgency: "MEDIUM" }, [rakhima, ainur], cfo, accountant, true);

  // 3. Гонорар Динаре 250 000 ₸ (договор 250k × 100%) — в реестре, ещё не оплачен.
  await fullApprovePayPath(staff, { expenseTypeId: bloggerFee, projectId: "demo_project_nauryz", recipientId: "demo_recipient_dinara", contractAmountTiyn: 25_000_000n, paymentPercent: 100, deliverables: ["VIDEO_POST"], paymentTiming: "PREPAY", urgency: "MEDIUM" }, [rakhima, ainur], cfo, accountant, false);

  // 4. Офисный расход 200 000 ₸ — оплачен (для факта в бюджете 6890).
  await fullApprovePayPath(officeMgr, { expenseTypeId: officeExp, amountTiyn: 20_000_000n, purpose: "Подписка на сервис, июнь", urgency: "NOT_URGENT" }, [kalamkas], cfo, accountant, true);

  // Итоги
  const balance = (await prisma.transaction.aggregate({ where: { projectId: "demo_project_nauryz" }, _sum: { amount: true } }))._sum.amount;
  console.log("Готово. Баланс проекта «Наурыз» (7366):", balance, "тиын (= 250 000 ₸: себест. 600k − выплачено 350k)");
  const reqs = await prisma.paymentRequest.groupBy({ by: ["status"], where: { entityId: E }, _count: true });
  console.log("Заявки по статусам:", reqs.map((r) => `${r.status}:${r._count}`).join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
