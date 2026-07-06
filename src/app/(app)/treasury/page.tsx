import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getRegisterRows, getTreasuryOverview, getCalendarData } from "@/lib/treasury/queries";
import { addToRegisterAction, removeFromRegisterAction } from "@/lib/treasury/actions";
import { formatTiyn } from "@/lib/money";
import { StatusBadge, UrgencyBadge } from "@/components/StatusBadge";
import { ProjectPeek } from "@/components/ProjectPeek";

export default async function TreasuryPage() {
  const user = await requireRole("TREASURER_CFO", "TREASURY_BOARD");
  const overview = await getTreasuryOverview(user.entityId);
  const rows = await getRegisterRows(user.entityId);
  const calendar = await getCalendarData(user.entityId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Казначейство</h1>

      {/* Остатки на счетах */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Остатки на счетах</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {overview.accounts.map((a) => (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">{a.code} · {a.name}</p>
              <p className={`mt-1 text-lg font-semibold ${a.balance < 0n ? "text-red-600" : "text-gray-900"}`}>
                {formatTiyn(a.balance)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Реестр на оплату */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Реестр на оплату</h2>
          <p className="text-xs text-gray-500">
            В реестре: {formatTiyn(overview.inRegisterTotal)} ({overview.inRegisterCount}) ·
            Одобрено: {formatTiyn(overview.approvedTotal)} ({overview.approvedCount})
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            Нет одобренных заявок к оплате.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Срочность</th>
                  <th className="px-4 py-2.5 font-medium">Заявка</th>
                  <th className="px-4 py-2.5 font-medium">Вид / проект</th>
                  <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                  <th className="px-4 py-2.5 font-medium">Оплатить до</th>
                  <th className="px-4 py-2.5 font-medium">Статус</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className={r.projectNegative ? "bg-amber-50/40" : ""}>
                    <td className="px-4 py-3"><UrgencyBadge urgency={r.urgency} /></td>
                    <td className="px-4 py-3">
                      <Link href={`/requests/${r.id}`} className="font-medium text-indigo-600 hover:underline">{r.number}</Link>
                      {r.projectNegative && (
                        <span className="ml-2 text-xs text-amber-700" title="Проект с отрицательным балансом — клиент ещё не заплатил">⚠ можно притормозить</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.expenseType.name}
                      {r.project && (
                        <>
                          {" · "}
                          <ProjectPeek projectId={r.project.id} className="inline text-left text-gray-700 hover:text-indigo-600 hover:underline">
                            {r.project.name}
                          </ProjectPeek>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatTiyn(r.amount)}</td>
                    <td className="px-4 py-3">
                      {r.desiredPayDate ? (
                        <span className={r.desiredPayDate < today ? "font-medium text-red-600" : "text-gray-600"}>
                          {r.desiredPayDate.toLocaleDateString("ru-RU")}
                          {r.desiredPayDate < today && " ⚠"}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-right">
                      {r.status === "APPROVED" ? (
                        <form action={addToRegisterAction.bind(null, r.id)}>
                          <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">В реестр →</button>
                        </form>
                      ) : (
                        <form action={removeFromRegisterAction.bind(null, r.id)}>
                          <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">Убрать</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">
          ⚠ — выплата по проекту с отрицательным балансом (клиент ещё не заплатил). Решение «проводим сегодня» — коллегиально (CFO + гл. бух + опер. директор). Отметку «оплачено» ставит бухгалтер в разделе «Оплаты».
        </p>
      </section>

      {/* Платёжный календарь */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Ожидаемые выплаты</h2>
          {calendar.payments.length === 0 ? (
            <p className="text-sm text-gray-400">Нет запланированных выплат.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {calendar.payments.map((p) => (
                <li key={p.id} className="flex justify-between">
                  <span className="text-gray-600">
                    {p.desiredPayDate ? p.desiredPayDate.toLocaleDateString("ru-RU") : "без даты"} · {p.expenseType.name}
                  </span>
                  <span className="font-medium text-gray-900">{formatTiyn(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Ожидаемые поступления (по сметам)</h2>
          {calendar.receivables.length === 0 ? (
            <p className="text-sm text-gray-400">Нет ожидаемых поступлений.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {calendar.receivables.map((r) => (
                <li key={r.projectId} className="flex justify-between">
                  <span className="text-gray-600">{r.clientName ? `${r.clientName} · ` : ""}{r.name}</span>
                  <span className="font-medium text-green-700">{formatTiyn(r.outstanding)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
