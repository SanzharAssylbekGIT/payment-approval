// Сид-данные Brave Talents.
// Справочник людей — CLAUDE.md §13, маршруты — §7, счета — §3, услуги — §4.
// Идемпотентен: повторный запуск обновляет, а не дублирует.
//
// Пароль всех демо-пользователей: "password123" (сменить в проде).

import { PrismaClient, AccountKind, LedgerKind, RoleName, ServiceType, Urgency, EstimateChangeReason, RecipientKind, EstimateLineKind, RequestStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ENTITY_ID = "entity_bravetalents";

// --- Департаменты (единица конфиденциальности) ---
const DEPARTMENTS: { code: string; name: string }[] = [
  { code: "MANAGEMENT", name: "Управление" },
  { code: "FINANCE", name: "Бухгалтерия" },
  { code: "BLOGGERS", name: "Блогерский блок" },
  { code: "COMMERCIAL", name: "Коммерческий блок" },
  { code: "CREATIVE", name: "Креатив" },
  { code: "PRODUCTION", name: "Продакшн" },
  { code: "OFFICE", name: "Офис" },
];

// --- Счета (CLAUDE.md §3) ---
const ACCOUNTS: { code: string; name: string; kind: AccountKind }[] = [
  { code: "6890", name: "Основной счёт", kind: AccountKind.MAIN },
  { code: "7366", name: "Оборотный счёт себестоимости проектов", kind: AccountKind.PROJECT_COST },
  { code: "3098", name: "Счёт НДС", kind: AccountKind.VAT },
  { code: "0175", name: "Счёт спецпроектов", kind: AccountKind.SPECPROJECT },
];

// --- Леджеры (DECISIONS.md §7): проекты/депозиты/резервы ---
const LEDGERS: { kind: LedgerKind; name: string; accountCode: string; collapsesToMargin: boolean }[] = [
  { kind: LedgerKind.COST_7366, name: "Себестоимость проектов (7366)", accountCode: "7366", collapsesToMargin: true },
  { kind: LedgerKind.DEPOSIT_INFLUENCE, name: "Депозит продакшна (Influence)", accountCode: "7366", collapsesToMargin: false },
  { kind: LedgerKind.RESERVE_COMMERCIAL, name: "Резерв коммерческого продакшна (Video/Photo)", accountCode: "7366", collapsesToMargin: false },
  { kind: LedgerKind.SPECPROJECT_0175, name: "Спецпроекты (0175)", accountCode: "0175", collapsesToMargin: true },
];

// --- Пользователи (CLAUDE.md §13) ---
const USERS: {
  key: string;
  email: string;
  fullName: string;
  position: string;
  dept: string;
  roles: RoleName[];
}[] = [
  { key: "sanzhar", email: "sanzhar.assylbek@bravetalents.com", fullName: "Санжар Асылбек", position: "CFO / Управляющий директор", dept: "MANAGEMENT", roles: [RoleName.TREASURER_CFO, RoleName.TREASURY_BOARD, RoleName.APPROVER, RoleName.ADMIN] },
  { key: "zhadyra", email: "zhadyra.kasymbek@bravetalents.com", fullName: "Жадыра Касымбек", position: "Главный бухгалтер", dept: "FINANCE", roles: [RoleName.CHIEF_ACCOUNTANT, RoleName.TREASURY_BOARD, RoleName.APPROVER] },
  { key: "symbat", email: "symbat.otesh@bravetalents.com", fullName: "Сымбат Отеш", position: "Бухгалтер", dept: "FINANCE", roles: [RoleName.ACCOUNTANT, RoleName.REQUESTER] },
  { key: "elnura", email: "elnura.ordabaeva@bravetalents.com", fullName: "Эльнура Ордабаева", position: "Бухгалтер", dept: "FINANCE", roles: [RoleName.ACCOUNTANT, RoleName.REQUESTER] },
  { key: "ainur", email: "ainur.abduali@bravetalents.com", fullName: "Айнур Абдували", position: "Операционный директор", dept: "MANAGEMENT", roles: [RoleName.APPROVER, RoleName.TREASURY_BOARD] },
  { key: "kalamkas", email: "kalamkas.alimova@bravetalents.com", fullName: "Каламкас Алимова", position: "HR-директор", dept: "OFFICE", roles: [RoleName.APPROVER] },
  { key: "azhar", email: "azhar.rakhat@bravetalents.com", fullName: "Ажар Рахат", position: "Коммерческий директор", dept: "COMMERCIAL", roles: [RoleName.APPROVER, RoleName.REQUESTER] },
  { key: "rakhima", email: "rakhima.turzhanova@bravetalents.com", fullName: "Рахима Туржанова", position: "Директор блогеров", dept: "BLOGGERS", roles: [RoleName.APPROVER] },
  { key: "kristiana", email: "kristiana.denisenko@bravetalents.com", fullName: "Кристиана Денисенко", position: "Креатив-лид", dept: "CREATIVE", roles: [RoleName.APPROVER, RoleName.REQUESTER] },
  { key: "dimash", email: "dimash@bravetalents.com", fullName: "Димаш", position: "Мл. линейный продюсер", dept: "PRODUCTION", roles: [RoleName.REQUESTER] },
  { key: "ramzat", email: "ramzat@bravetalents.com", fullName: "Рамзат", position: "Линейный продюсер", dept: "PRODUCTION", roles: [RoleName.REQUESTER] },
  { key: "aisulu", email: "aisulu@bravetalents.com", fullName: "Айсулу", position: "Продюсер (Event/Spec)", dept: "COMMERCIAL", roles: [RoleName.REQUESTER] },
  { key: "tima", email: "tima@bravetalents.com", fullName: "Тима", position: "Продюсер (Event/Spec)", dept: "COMMERCIAL", roles: [RoleName.REQUESTER] },
  { key: "zhaskairat", email: "zhaskairat@bravetalents.com", fullName: "Жаскайрат", position: "Ассистент", dept: "MANAGEMENT", roles: [RoleName.REQUESTER] },
  { key: "office_manager", email: "office.manager@bravetalents.com", fullName: "Офис-менеджер", position: "Офис-менеджер", dept: "OFFICE", roles: [RoleName.REQUESTER] },
  { key: "it_manager", email: "it.manager@bravetalents.com", fullName: "IT-менеджер", position: "IT-менеджер", dept: "OFFICE", roles: [RoleName.REQUESTER] },
  { key: "blogger_staff", email: "blogger.staff@bravetalents.com", fullName: "Сотрудник блог-отдела", position: "Менеджер по работе с блогерами", dept: "BLOGGERS", roles: [RoleName.REQUESTER] },
];

// --- Виды расходов и маршруты (CLAUDE.md §7) ---
const EXPENSE_TYPES: {
  code: string;
  name: string;
  accountKind: AccountKind;
  isProjectCost: boolean;
  requiresEstimate: boolean;
  serviceType: ServiceType | null;
  urgency: Urgency;
  dept: string;
  route: string[]; // ключи пользователей по порядку ступеней
}[] = [
  // Проектные расходы (себестоимость)
  { code: "BLOGGER_FEE", name: "Гонорары блогеров", accountKind: AccountKind.PROJECT_COST, isProjectCost: true, requiresEstimate: true, serviceType: ServiceType.INFLUENCE, urgency: Urgency.MEDIUM, dept: "BLOGGERS", route: ["rakhima", "ainur"] },
  { code: "PRODUCTION_BUDGET", name: "Продакшн-бюджет (Influence)", accountKind: AccountKind.PROJECT_COST, isProjectCost: true, requiresEstimate: true, serviceType: ServiceType.INFLUENCE, urgency: Urgency.MEDIUM, dept: "PRODUCTION", route: ["ainur"] },
  { code: "VIDEO_PHOTO", name: "Video/Photo production", accountKind: AccountKind.PROJECT_COST, isProjectCost: true, requiresEstimate: true, serviceType: ServiceType.VIDEO_PHOTO, urgency: Urgency.MEDIUM, dept: "PRODUCTION", route: ["ainur"] },
  { code: "EVENT", name: "Event", accountKind: AccountKind.PROJECT_COST, isProjectCost: true, requiresEstimate: true, serviceType: ServiceType.EVENT, urgency: Urgency.MEDIUM, dept: "COMMERCIAL", route: ["sanzhar"] },
  { code: "SPEC_PROJECT", name: "Spec project", accountKind: AccountKind.SPECPROJECT, isProjectCost: true, requiresEstimate: true, serviceType: ServiceType.SPEC_PROJECT, urgency: Urgency.MEDIUM, dept: "COMMERCIAL", route: ["sanzhar"] },
  // Прочие расходы (6890)
  { code: "COMMERCIAL_EXP", name: "Расходы ком-блока", accountKind: AccountKind.MAIN, isProjectCost: false, requiresEstimate: false, serviceType: null, urgency: Urgency.NOT_URGENT, dept: "COMMERCIAL", route: ["azhar"] },
  { code: "BLOGGERS_DEPT_EXP", name: "Расходы блог-департамента", accountKind: AccountKind.MAIN, isProjectCost: false, requiresEstimate: false, serviceType: null, urgency: Urgency.NOT_URGENT, dept: "BLOGGERS", route: ["rakhima"] },
  { code: "CREATIVE_EXP", name: "Расходы креатива", accountKind: AccountKind.MAIN, isProjectCost: false, requiresEstimate: false, serviceType: null, urgency: Urgency.NOT_URGENT, dept: "CREATIVE", route: ["kristiana"] },
  { code: "OFFICE_EXP", name: "Офисные расходы", accountKind: AccountKind.MAIN, isProjectCost: false, requiresEstimate: false, serviceType: null, urgency: Urgency.NOT_URGENT, dept: "OFFICE", route: ["kalamkas"] },
  { code: "SALARY", name: "Зарплата", accountKind: AccountKind.MAIN, isProjectCost: false, requiresEstimate: false, serviceType: null, urgency: Urgency.URGENT, dept: "FINANCE", route: ["zhadyra"] },
  { code: "DIVIDENDS", name: "Дивиденды Алмаса", accountKind: AccountKind.MAIN, isProjectCost: false, requiresEstimate: false, serviceType: null, urgency: Urgency.NOT_URGENT, dept: "MANAGEMENT", route: ["sanzhar", "zhadyra"] },
];

async function main() {
  console.log("Сидирование Brave Talents…");

  // Entity
  await prisma.entity.upsert({
    where: { id: ENTITY_ID },
    update: { name: "Brave Talents" },
    create: { id: ENTITY_ID, name: "Brave Talents" },
  });

  // Departments
  const deptId: Record<string, string> = {};
  for (const d of DEPARTMENTS) {
    const rec = await prisma.department.upsert({
      where: { entityId_code: { entityId: ENTITY_ID, code: d.code } },
      update: { name: d.name },
      create: { entityId: ENTITY_ID, code: d.code, name: d.name },
    });
    deptId[d.code] = rec.id;
  }

  // Accounts
  const accountId: Record<string, string> = {};
  for (const a of ACCOUNTS) {
    const rec = await prisma.account.upsert({
      where: { entityId_code: { entityId: ENTITY_ID, code: a.code } },
      update: { name: a.name, kind: a.kind },
      create: { entityId: ENTITY_ID, code: a.code, name: a.name, kind: a.kind },
    });
    accountId[a.code] = rec.id;
  }

  // Ledgers
  const ledgerId: Record<string, string> = {};
  for (const l of LEDGERS) {
    const rec = await prisma.ledger.upsert({
      where: { entityId_kind: { entityId: ENTITY_ID, kind: l.kind } },
      update: { name: l.name, accountId: accountId[l.accountCode], collapsesToMargin: l.collapsesToMargin },
      create: { entityId: ENTITY_ID, kind: l.kind, name: l.name, accountId: accountId[l.accountCode], collapsesToMargin: l.collapsesToMargin },
    });
    ledgerId[l.kind] = rec.id;
  }

  // Users + roles
  const passwordHash = await bcrypt.hash("password123", 10);
  const userId: Record<string, string> = {};
  for (const u of USERS) {
    const rec = await prisma.user.upsert({
      where: { email: u.email },
      update: { fullName: u.fullName, position: u.position, departmentId: deptId[u.dept] },
      create: { entityId: ENTITY_ID, email: u.email, fullName: u.fullName, position: u.position, departmentId: deptId[u.dept], passwordHash },
    });
    userId[u.key] = rec.id;
    for (const role of u.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: rec.id, role } },
        update: {},
        create: { userId: rec.id, role },
      });
    }
  }

  // Expense types + approval routes
  for (const e of EXPENSE_TYPES) {
    const et = await prisma.expenseType.upsert({
      where: { entityId_code: { entityId: ENTITY_ID, code: e.code } },
      update: { name: e.name, accountKind: e.accountKind, isProjectCost: e.isProjectCost, requiresEstimate: e.requiresEstimate, serviceType: e.serviceType ?? undefined, defaultUrgency: e.urgency, departmentId: deptId[e.dept] },
      create: { entityId: ENTITY_ID, code: e.code, name: e.name, accountKind: e.accountKind, isProjectCost: e.isProjectCost, requiresEstimate: e.requiresEstimate, serviceType: e.serviceType ?? undefined, defaultUrgency: e.urgency, departmentId: deptId[e.dept] },
    });

    const route = await prisma.approvalRoute.upsert({
      where: { expenseTypeId: et.id },
      update: {},
      create: { entityId: ENTITY_ID, expenseTypeId: et.id },
    });
    // Синхронизируем ступени БЕЗ полного deleteMany: у ступеней с историей
    // согласований RESTRICT-FK (RequestApproval.stepId) — сид не должен падать
    // и не должен рвать историю на живой базе.
    const desired = e.route.map((key, idx) => ({ order: idx + 1, approverId: userId[key] }));
    for (const step of desired) {
      await prisma.approvalStep.upsert({
        where: { routeId_order_approverId: { routeId: route.id, order: step.order, approverId: step.approverId } },
        update: {},
        create: { routeId: route.id, order: step.order, approverId: step.approverId },
      });
    }
    // Ступени вне конфига удаляем, только если по ним нет решений.
    const extras = await prisma.approvalStep.findMany({
      where: { routeId: route.id, NOT: { OR: desired.map((d) => ({ order: d.order, approverId: d.approverId })) } },
      include: { _count: { select: { approvals: true } } },
    });
    for (const ex of extras) {
      if (ex._count.approvals === 0) await prisma.approvalStep.delete({ where: { id: ex.id } });
    }
  }

  // --- Демо-данные для проверки прав (CLAUDE.md §14) ---
  await seedDemo(userId, ledgerId);
  await seedBudget();

  console.log("Готово. Пользователей:", USERS.length, "| Видов расходов:", EXPENSE_TYPES.length);
}

// Бюджет 6890 на 2026 (план по статьям). Факт считается по оплаченным заявкам.
async function seedBudget() {
  const year = 2026;
  let period = await prisma.budgetPeriod.findFirst({ where: { entityId: ENTITY_ID, year, month: null } });
  if (!period) period = await prisma.budgetPeriod.create({ data: { entityId: ENTITY_ID, year } });

  const PLAN: { code: string; title: string; amount: bigint }[] = [
    { code: "SALARY", title: "Зарплата", amount: 12_000_000_000n }, // 120 000 000 ₸
    { code: "OFFICE_EXP", title: "Офисные расходы", amount: 1_200_000_000n }, // 12 000 000 ₸
    { code: "COMMERCIAL_EXP", title: "Расходы ком-блока", amount: 500_000_000n }, // 5 000 000 ₸
    { code: "BLOGGERS_DEPT_EXP", title: "Расходы блог-департамента", amount: 400_000_000n }, // 4 000 000 ₸
    { code: "CREATIVE_EXP", title: "Расходы креатива", amount: 300_000_000n }, // 3 000 000 ₸
  ];

  await prisma.budgetLine.deleteMany({ where: { periodId: period.id } });
  for (const p of PLAN) {
    const et = await prisma.expenseType.findUnique({ where: { entityId_code: { entityId: ENTITY_ID, code: p.code } } });
    await prisma.budgetLine.create({ data: { periodId: period.id, expenseTypeId: et?.id, title: p.title, plannedAmount: p.amount } });
  }
}

// Небольшой демо-набор: 1 клиент, 1 проект Influence «Наурыз», смета + 2 получателя,
// одна черновая заявка на гонорар. Все суммы в тиынах.
async function seedDemo(userId: Record<string, string>, ledgerId: Record<string, string>) {
  const client = await prisma.client.upsert({
    where: { id: "demo_client_yandex" },
    update: { name: "Яндекс Поиск" },
    create: { id: "demo_client_yandex", entityId: ENTITY_ID, name: "Яндекс Поиск" },
  });

  const project = await prisma.project.upsert({
    where: { id: "demo_project_nauryz" },
    update: { name: "Наурыз" },
    create: {
      id: "demo_project_nauryz",
      entityId: ENTITY_ID,
      ledgerId: ledgerId[LedgerKind.COST_7366],
      clientId: client.id,
      name: "Наурыз",
      serviceType: ServiceType.INFLUENCE,
      ownerUserId: userId["rakhima"],
      departmentId: (await prisma.user.findUnique({ where: { id: userId["rakhima"] } }))?.departmentId,
    },
  });

  const aibek = await prisma.recipient.upsert({
    where: { id: "demo_recipient_aibek" },
    update: { name: "Блогер Айбек" },
    create: { id: "demo_recipient_aibek", entityId: ENTITY_ID, projectId: project.id, name: "Блогер Айбек", kind: RecipientKind.BLOGGER },
  });
  const dinara = await prisma.recipient.upsert({
    where: { id: "demo_recipient_dinara" },
    update: { name: "Блогер Динара" },
    create: { id: "demo_recipient_dinara", entityId: ENTITY_ID, projectId: project.id, name: "Блогер Динара", kind: RecipientKind.BLOGGER },
  });

  // Смета: цена клиенту 1 000 000 ₸ (НДС 12%), себестоимость 600 000 ₸.
  const estimate = await prisma.estimate.upsert({
    where: { id: "demo_estimate_nauryz" },
    update: {},
    create: { id: "demo_estimate_nauryz", entityId: ENTITY_ID, projectId: project.id },
  });

  const version = await prisma.estimateVersion.upsert({
    where: { id: "demo_estimate_v1" },
    update: {},
    create: {
      id: "demo_estimate_v1",
      estimateId: estimate.id,
      version: 1,
      clientPriceGross: 100_000_000n, // 1 000 000 ₸
      clientPriceNet: 89_285_714n, // 892 857,14 ₸
      vatAmount: 10_714_286n, // 107 142,86 ₸ (gross-net)
      costAmount: 60_000_000n, // 600 000 ₸
      marginAmount: 29_285_714n, // net - cost
      depositAmount: 0n,
      reason: EstimateChangeReason.INITIAL,
      createdById: userId["rakhima"],
    },
  });
  await prisma.estimate.update({ where: { id: estimate.id }, data: { currentVersionId: version.id } });

  // Плановые строки сметы (получатели). Сумма == себестоимость.
  await prisma.estimateLine.deleteMany({ where: { versionId: version.id } });
  const lineAibek = await prisma.estimateLine.create({
    data: { versionId: version.id, kind: EstimateLineKind.RECIPIENT, title: "Блогер Айбек", plannedAmount: 35_000_000n, recipientId: aibek.id },
  });
  await prisma.estimateLine.create({
    data: { versionId: version.id, kind: EstimateLineKind.RECIPIENT, title: "Блогер Динара", plannedAmount: 25_000_000n, recipientId: dinara.id },
  });

  // Черновая заявка на гонорар Айбеку, привязанная к плановой строке сметы.
  const bloggerFee = await prisma.expenseType.findUnique({ where: { entityId_code: { entityId: ENTITY_ID, code: "BLOGGER_FEE" } } });
  if (bloggerFee) {
    await prisma.paymentRequest.upsert({
      where: { entityId_number: { entityId: ENTITY_ID, number: "REQ-0001" } },
      update: {},
      create: {
        entityId: ENTITY_ID,
        number: "REQ-0001",
        expenseTypeId: bloggerFee.id,
        status: RequestStatus.DRAFT,
        createdById: userId["blogger_staff"],
        projectId: project.id,
        recipientId: aibek.id,
        estimateLineId: lineAibek.id,
        amount: 35_000_000n,
        purpose: "Гонорар за участие в проекте «Наурыз»",
        urgency: Urgency.MEDIUM,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
