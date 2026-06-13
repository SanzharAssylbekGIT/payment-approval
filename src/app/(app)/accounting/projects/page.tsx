import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getClientProjectTree } from "@/lib/accounting/queries";
import { formatTiyn } from "@/lib/money";
import { SERVICE_LABELS } from "@/lib/accounting/labels";

function balanceClass(b: bigint) {
  return b < 0n ? "text-red-600" : b > 0n ? "text-green-700" : "text-gray-500";
}

export default async function ProjectsPage() {
  await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const { clients, total } = await getClientProjectTree();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Учёт</Link>
          <h1 className="mt-1 text-xl font-semibold text-gray-900">Проектные балансы 7366</h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">Общий баланс 7366</p>
          <p className={`text-lg font-semibold ${balanceClass(total)}`}>{formatTiyn(total)}</p>
        </div>
      </div>

      {clients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Нет проектов на 7366.</div>
      ) : (
        <div className="space-y-4">
          {clients.map((c) => (
            <div key={c.clientId ?? "none"} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5">
                <span className="text-sm font-semibold text-gray-800">{c.clientName}</span>
                <span className={`text-sm font-semibold ${balanceClass(c.balance)}`}>{formatTiyn(c.balance)}</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {c.projects.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <Link href={`/accounting/projects/${p.id}`} className="font-medium text-indigo-600 hover:underline">{p.name}</Link>
                        <span className="ml-2 text-xs text-gray-400">{SERVICE_LABELS[p.serviceType]}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{p.recipientCount} получателей</td>
                      <td className={`px-4 py-2.5 text-right font-medium ${balanceClass(p.balance)}`}>{formatTiyn(p.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400">«+» клиент заплатил, получателям ещё не выплачено · «−» выплачено, клиент ещё не заплатил.</p>
    </div>
  );
}
