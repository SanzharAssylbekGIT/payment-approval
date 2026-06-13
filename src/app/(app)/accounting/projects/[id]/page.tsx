import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/rbac";
import { getProjectDetail } from "@/lib/accounting/queries";
import { formatTiyn } from "@/lib/money";
import { SERVICE_LABELS } from "@/lib/accounting/labels";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const data = await getProjectDetail(user.entityId, id);
  if (!data) notFound();
  const { project, recipients, balance, paidCount, toPayCount } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/accounting/projects" className="text-sm text-gray-500 hover:underline">← Проектные балансы</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">
          {project.client?.name ? `${project.client.name} · ` : ""}{project.name}
        </h1>
        <p className="text-sm text-gray-500">{SERVICE_LABELS[project.serviceType]}</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Баланс проекта</p>
          <p className={`text-lg font-semibold ${balance < 0n ? "text-red-600" : balance > 0n ? "text-green-700" : "text-gray-700"}`}>{formatTiyn(balance)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">Оплачено получателей</p>
          <p className="text-lg font-semibold text-gray-900">{paidCount}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">К оплате</p>
          <p className="text-lg font-semibold text-gray-900">{toPayCount}</p>
        </div>
      </div>

      {/* Получатели: план (смета) / факт (выплачено) */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Получатели</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Имя</th>
                <th className="px-4 py-2.5 text-right font-medium">План (смета)</th>
                <th className="px-4 py-2.5 text-right font-medium">Выплачено</th>
                <th className="px-4 py-2.5 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{formatTiyn(r.planned)}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-gray-900">{formatTiyn(r.paid)}</td>
                  <td className="px-4 py-2.5">
                    {r.isPaid ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">оплачен</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">не оплачен</span>
                    )}
                  </td>
                </tr>
              ))}
              {recipients.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">Нет получателей</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Поступления по проекту */}
      {project.incomings.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-gray-700">Поступления от клиента</h2>
          <ul className="space-y-1.5 text-sm">
            {project.incomings.map((i) => (
              <li key={i.id} className="flex justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
                <span className="text-gray-600">{i.receivedAt.toLocaleDateString("ru-RU")} · {i.status === "ALLOCATED" ? "разнесено" : "не разнесено"}</span>
                <span className="font-medium text-gray-900">{formatTiyn(i.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
