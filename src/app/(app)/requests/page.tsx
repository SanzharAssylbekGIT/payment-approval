import Link from "next/link";
import { requireUser } from "@/lib/auth/rbac";
import { getMyRequests, getMyRequestStatusCounts } from "@/lib/requests/queries";
import { formatTiyn } from "@/lib/money";
import { StatusBadge, UrgencyBadge } from "@/components/StatusBadge";
import { ProjectPeek } from "@/components/ProjectPeek";
import { STATUS_LABELS } from "@/lib/requests/status";
import type { RequestStatus } from "@prisma/client";

// Порядок статусов во вкладках-фильтрах.
const FILTER_ORDER: RequestStatus[] = [
  "DRAFT", "CLARIFICATION", "PENDING_APPROVAL", "APPROVED", "IN_REGISTER", "PAID", "REJECTED", "CANCELLED",
];

// Статусы, требующие действия автора.
const NEEDS_ACTION: RequestStatus[] = ["DRAFT", "CLARIFICATION"];

function isRequestStatus(v: string | undefined): v is RequestStatus {
  return !!v && v in STATUS_LABELS;
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const active = isRequestStatus(sp.status) ? sp.status : undefined;

  const [requests, { counts, total }] = await Promise.all([
    getMyRequests(user, active),
    getMyRequestStatusCounts(user),
  ]);

  const tabs = FILTER_ORDER.filter((s) => (counts[s] ?? 0) > 0);
  const actionCount = NEEDS_ACTION.reduce((n, s) => n + (counts[s] ?? 0), 0);

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

      {actionCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          Требует вашего действия: <span className="font-semibold">{actionCount}</span> — черновики и заявки на доработке.
        </div>
      )}

      {/* Фильтр по статусу */}
      {total > 0 && (
        <div className="flex flex-wrap gap-2">
          <FilterTab label="Все" count={total} href="/requests" activeNow={!active} />
          {tabs.map((s) => (
            <FilterTab
              key={s}
              label={STATUS_LABELS[s]}
              count={counts[s] ?? 0}
              href={`/requests?status=${s}`}
              activeNow={active === s}
            />
          ))}
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {active ? "Нет заявок с этим статусом." : "У вас пока нет заявок. Нажмите «Создать заявку», чтобы подать первую."}
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
                <th className="px-4 py-2.5 font-medium">Срочность</th>
                <th className="px-4 py-2.5 font-medium">Дата</th>
                <th className="px-4 py-2.5 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.map((r) => {
                const needsAction = NEEDS_ACTION.includes(r.status);
                return (
                  <tr key={r.id} className={needsAction ? "bg-amber-50/50 hover:bg-amber-50" : "hover:bg-gray-50"}>
                    <td className="px-4 py-3">
                      <Link href={`/requests/${r.id}`} className="font-medium text-indigo-600 hover:underline">
                        {r.number}
                      </Link>
                      {needsAction && <span className="ml-2 text-xs text-amber-700">• требует действия</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.expenseType.name}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.project ? (
                        <span>
                          <ProjectPeek projectId={r.project.id} className="inline text-left text-gray-700 hover:text-indigo-600 hover:underline">
                            {r.project.client?.name ? `${r.project.client.name} · ` : ""}
                            {r.project.name}
                          </ProjectPeek>
                          {r.recipient ? ` → ${r.recipient.name}` : ""}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatTiyn(r.amount)}</td>
                    <td className="px-4 py-3"><UrgencyBadge urgency={r.urgency} /></td>
                    <td className="px-4 py-3 text-gray-500">{r.createdAt.toLocaleDateString("ru-RU")}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterTab({ label, count, href, activeNow }: { label: string; count: number; href: string; activeNow: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        activeNow ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {label} <span className={activeNow ? "text-indigo-100" : "text-gray-400"}>{count}</span>
    </Link>
  );
}
