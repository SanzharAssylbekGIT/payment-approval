import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getDepositsReserves } from "@/lib/accounting/queries";
import { formatTiyn } from "@/lib/money";
import { LEDGER_LABELS } from "@/lib/accounting/labels";

export default async function DepositsPage() {
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const ledgers = await getDepositsReserves(user.entityId);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Учёт</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Депозиты и резервы</h1>
        <p className="text-sm text-gray-500">Остаток себестоимости не схлопывается в маржу, а сохраняется под будущие нужды.</p>
      </div>

      {ledgers.map((l) => (
        <section key={l.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-800">{LEDGER_LABELS[l.kind]}</p>
            <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-500">Приток</p>
                <p className="font-medium text-green-700">{formatTiyn(l.inflow)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Отток</p>
                <p className="font-medium text-red-600">{l.outflow > 0n ? `−${formatTiyn(l.outflow)}` : formatTiyn(0n)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Остаток</p>
                <p className={`font-semibold ${l.balance < 0n ? "text-red-600" : "text-gray-900"}`}>{formatTiyn(l.balance)}</p>
              </div>
            </div>
          </div>
          {l.movements.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">
              {l.kind === "DEPOSIT_INFLUENCE"
                ? "Пока нет движений. Копилка пополняется при разнесении поступлений по сделкам с продакшн-резервом."
                : "Пока нет движений. Копилка пополняется остатком себестоимости при закрытии Video/Photo-проектов."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Дата</th>
                  <th className="px-4 py-2 font-medium">Проект / описание</th>
                  <th className="px-4 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {l.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 whitespace-nowrap text-gray-500">{m.occurredAt.toLocaleDateString("ru-RU")}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {m.project ? (
                        <Link href={`/projects/${m.project.id}`} className="text-indigo-600 hover:underline">
                          {m.project.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {m.description ? ` · ${m.description}` : ""}
                      {m.paymentRequest ? ` · заявка ${m.paymentRequest.number}` : ""}
                    </td>
                    <td className={`px-4 py-2 text-right font-medium ${m.amount < 0n ? "text-red-600" : "text-green-700"}`}>
                      {formatTiyn(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <p className="text-xs text-gray-400">
        Приток («+») пополняет копилку, отток («−») расходует. Депозит продакшна пополняется долей продакшн-резерва при
        разнесении оплат клиентов и расходуется выплатами по виду «Продакшн-бюджет (Influence)». Резерв коммерческого
        продакшна пополняется остатком себестоимости при закрытии Video/Photo-проектов.
      </p>
    </div>
  );
}
