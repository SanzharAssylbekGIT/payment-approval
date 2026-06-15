import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getBudget6890 } from "@/lib/budget/queries";
import { formatTiyn } from "@/lib/money";

const MONTHS = ["", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

export default async function BudgetPage() {
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const budget = await getBudget6890(user.entityId, 2026, 5);
  const periodLabel = budget.month ? `${MONTHS[budget.month]} ${budget.year}` : `${budget.year}`;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Учёт</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Бюджет 6890 (бэк-офис) · {periodLabel}</h1>
        <p className="text-sm text-gray-500">План по статьям. Факт за месяц добавляется из фактических расходов.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card label="План на месяц" value={formatTiyn(budget.totalPlan)} />
        <Card label="Факт (май)" value={formatTiyn(budget.totalFact)} />
        <Card label="Освоение" value={`${budget.totalPct}%`} />
      </div>

      {!budget.hasPeriod || budget.lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Бюджет на {periodLabel} не задан.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Статья</th>
                <th className="px-4 py-2.5 text-right font-medium">План</th>
                <th className="px-4 py-2.5 text-right font-medium">Факт (май)</th>
                <th className="px-4 py-2.5 text-right font-medium">Отклонение</th>
                <th className="px-4 py-2.5 text-right font-medium">% освоения</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {budget.lines.map((l) => (
                <tr key={l.id} className={l.planned === 0n && l.actual === 0n ? "text-gray-400" : ""}>
                  <td className="px-4 py-2 text-gray-800">{l.title}</td>
                  <td className="px-4 py-2 text-right">{formatTiyn(l.planned)}</td>
                  <td className="px-4 py-2 text-right">{l.actual > 0n ? formatTiyn(l.actual) : "—"}</td>
                  <td className={`px-4 py-2 text-right ${l.deviation < 0n ? "text-red-600" : "text-gray-500"}`}>
                    {l.actual > 0n ? formatTiyn(l.deviation) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {l.planned > 0n ? (
                      <span className={l.pct > 100 ? "text-red-600 font-medium" : "text-gray-600"}>{l.pct}%</span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-medium text-gray-900">
              <tr>
                <td className="px-4 py-2.5">Итого ({budget.lines.length} статей)</td>
                <td className="px-4 py-2.5 text-right">{formatTiyn(budget.totalPlan)}</td>
                <td className="px-4 py-2.5 text-right">{budget.totalFact > 0n ? formatTiyn(budget.totalFact) : "—"}</td>
                <td className="px-4 py-2.5 text-right">{budget.totalFact > 0n ? formatTiyn(budget.totalDeviation) : "—"}</td>
                <td className="px-4 py-2.5 text-right">{budget.totalPct}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400">Факт пока не заполнен: следующий шаг — привязать фактические майские расходы 6890 к статьям бюджета.</p>
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
