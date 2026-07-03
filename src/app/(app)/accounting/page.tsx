import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getAccountingOverview } from "@/lib/accounting/queries";
import { formatTiyn } from "@/lib/money";
import { LEDGER_LABELS } from "@/lib/accounting/labels";

const SECTIONS = [
  { href: "/accounting/projects", label: "Проектные балансы 7366", desc: "Клиент → Проект → Получатель" },
  { href: "/accounting/deposits", label: "Депозиты и резервы", desc: "Балансы и движения «копилок»" },
  { href: "/accounting/incomings", label: "Поступления", desc: "Регистрация и разнос по смете" },
  { href: "/accounting/import", label: "Импорт выписки", desc: "Загрузка Kaspi → разбор → сверка" },
  { href: "/accounting/budget", label: "Бюджет 6890", desc: "План-факт по статьям" },
  { href: "/accounting/report", label: "Ежемесячный отчёт", desc: "Поступления, расходы, маржа" },
];

export default async function AccountingPage() {
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const { accounts, ledgers } = await getAccountingOverview(user.entityId);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Учёт и дашборды</h1>

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Остатки по счетам</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">{a.code} · {a.name}</p>
              <p className={`mt-1 text-lg font-semibold ${a.balance < 0n ? "text-red-600" : "text-gray-900"}`}>{formatTiyn(a.balance)}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Балансы леджеров</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ledgers.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
              <span className="text-sm text-gray-700">{LEDGER_LABELS[l.kind]}</span>
              <span className={`text-base font-semibold ${l.balance < 0n ? "text-red-600" : "text-gray-900"}`}>{formatTiyn(l.balance)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Разделы</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map((s) => (
            <Link key={s.href} href={s.href} className="rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow">
              <p className="text-sm font-medium text-gray-800">{s.label} →</p>
              <p className="mt-0.5 text-xs text-gray-500">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
