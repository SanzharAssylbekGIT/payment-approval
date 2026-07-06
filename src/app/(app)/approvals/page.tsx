import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getApprovalQueue, getApprovalHistory } from "@/lib/requests/queries";
import { formatTiyn } from "@/lib/money";
import { StatusBadge, UrgencyBadge } from "@/components/StatusBadge";
import { ProjectPeek } from "@/components/ProjectPeek";

// Метки моего решения в истории согласования.
const DECISION_LABELS: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "Одобрено", cls: "text-green-700" },
  REJECTED: { label: "Отклонено", cls: "text-red-600" },
  CLARIFICATION_REQUESTED: { label: "На доработку", cls: "text-orange-600" },
};

export default async function ApprovalsPage() {
  const user = await requireRole("APPROVER", "CHIEF_ACCOUNTANT", "TREASURER_CFO");
  const [queue, history] = await Promise.all([getApprovalQueue(user), getApprovalHistory(user)]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Согласование</h1>
        <p className="mt-1 text-sm text-gray-500">Заявки, ожидающие вашего решения</p>
      </div>

      {queue.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          На вас сейчас нет заявок на согласовании.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Номер</th>
                <th className="px-4 py-2.5 font-medium">Автор</th>
                <th className="px-4 py-2.5 font-medium">Вид / проект</th>
                <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                <th className="px-4 py-2.5 font-medium">Срочность</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {queue.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.number}</td>
                  <td className="px-4 py-3 text-gray-700">{r.createdBy.fullName}</td>
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
                    <UrgencyBadge urgency={r.urgency} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/requests/${r.id}`} className="text-sm font-medium text-indigo-600 hover:underline">
                      Открыть →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* История моих решений: после решения заявка уходит дальше по маршруту
          и из очереди пропадает — здесь видно, что я решил и где заявка сейчас. */}
      {history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-gray-700">Ранее рассмотренные ({history.length})</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Номер</th>
                  <th className="px-4 py-2.5 font-medium">Автор</th>
                  <th className="px-4 py-2.5 font-medium">Вид / проект</th>
                  <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                  <th className="px-4 py-2.5 font-medium">Моё решение</th>
                  <th className="px-4 py-2.5 font-medium">Статус сейчас</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((h) => {
                  const d = DECISION_LABELS[h.decision] ?? { label: h.decision, cls: "text-gray-600" };
                  return (
                    <tr key={h.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/requests/${h.request.id}`} className="font-medium text-indigo-600 hover:underline">
                          {h.request.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{h.request.createdBy.fullName}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {h.request.expenseType.name}
                        {h.request.project && (
                          <>
                            {" · "}
                            <ProjectPeek projectId={h.request.project.id} className="inline text-left text-gray-700 hover:text-indigo-600 hover:underline">
                              {h.request.project.name}
                            </ProjectPeek>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">{formatTiyn(h.request.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${d.cls}`}>{d.label}</span>
                        <span className="ml-1.5 text-xs text-gray-400">{h.decidedAt.toLocaleDateString("ru-RU")}</span>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={h.request.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
