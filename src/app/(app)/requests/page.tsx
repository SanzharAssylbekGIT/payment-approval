import Link from "next/link";
import { requireUser } from "@/lib/auth/rbac";
import { getMyRequests } from "@/lib/requests/queries";
import { formatTiyn } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";

export default async function RequestsPage() {
  const user = await requireUser();
  const requests = await getMyRequests(user);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Мои заявки</h1>
        <Link
          href="/requests/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Создать заявку
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          У вас пока нет заявок. Нажмите «Создать заявку», чтобы подать первую.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Номер</th>
                <th className="px-4 py-2.5 font-medium">Вид расхода</th>
                <th className="px-4 py-2.5 font-medium">Проект / получатель</th>
                <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                <th className="px-4 py-2.5 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/requests/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.expenseType.name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {r.project ? (
                      <span>
                        {r.project.client?.name ? `${r.project.client.name} · ` : ""}
                        {r.project.name}
                        {r.recipient ? ` → ${r.recipient.name}` : ""}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{formatTiyn(r.amount)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
