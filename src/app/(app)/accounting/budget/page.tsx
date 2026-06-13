import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getBudget6890 } from "@/lib/budget/queries";
import { formatTiyn } from "@/lib/money";

export default async function BudgetPage() {
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const budget = await getBudget6890(user.entityId, 2026);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Учёт</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Бюджет 6890 · {budget.year}</h1>
        <p className="text-sm text-gray-500">План-факт по статьям (без дивидендов). Факт — по фактически оплаченным заявкам.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card label="План" value={formatTiyn(budget.totalPlan)} />
        <Card label="Факт" value={formatTiyn(budget.totalFact)} />
        <Card label="Освоение" value={`${budget.totalPct}%`} />
      </div>

      {!budget.hasPeriod || budget.lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Бюджет на {budget.year} не задан.</div>
      ) : (
        <div className="space-y-3">
          {budget.lines.map((l) => (
            <div key={l.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">{l.title}</span>
                <span className="text-sm text-gray-500">
                  {formatTiyn(l.actual)} / {formatTiyn(l.planned)}
                  <span className={`ml-2 font-medium ${l.deviation < 0n ? "text-red-600" : "text-green-700"}`}>
                    ({l.deviation < 0n ? "перерасход " : "остаток "}{formatTiyn(l.deviation < 0n ? -l.deviation : l.deviation)})
                  </span>
                </span>
              </div>
              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${l.pct > 100 ? "bg-red-500" : l.pct > 80 ? "bg-amber-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(l.pct, 100)}%` }}
                />
              </div>
              <p className="mt-1 text-right text-xs text-gray-400">{l.pct}% освоено</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}
