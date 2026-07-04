import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/rbac";
import { getProjectDetailForUser } from "@/lib/projects/queries";
import { saveEstimate } from "@/lib/estimates/actions";
import { closeProject, reopenProject } from "@/lib/projects/actions";
import { formatTiyn, tiynToInputString } from "@/lib/money";
import { SERVICE_LABELS, INCOMING_STATUS_LABELS, INCOMING_STATUS_STYLES } from "@/lib/accounting/labels";
import { DELIVERABLE_LABELS } from "@/lib/requests/status";
import { StatusBadge } from "@/components/StatusBadge";
import { EstimateForm } from "./EstimateForm";

const REASON_LABELS: Record<string, string> = {
  INITIAL: "первичная",
  WRONG_ESTIMATE: "исправление",
  PROJECT_REDUCED: "проект сокращён",
  OTHER: "другое",
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("ACCOUNT_MANAGER", "PROJECT_MANAGER", "TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const data = await getProjectDetailForUser(user, id);
  if (!data) notFound();

  const { project, recipients, balance, paidCount, paidTotal, receivedTotal, receivable, overpaid } = data;
  const current = project.estimate?.currentVersion ?? null;
  const versions = project.estimate?.versions ?? [];
  const nextVersionNo = (versions[0]?.version ?? 0) + 1;
  const gross = current?.clientPriceGross ?? 0n;
  const cost = current?.costAmount ?? 0n;
  // Заявки «в полёте» блокируют закрытие проекта.
  const inFlight = project.paymentRequests.filter((r) => ["PENDING_APPROVAL", "APPROVED", "IN_REGISTER"].includes(r.status)).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/projects" className="text-sm text-gray-500 hover:underline">← К проектам</Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">
            <span className="mr-1.5 text-gray-400">№ {project.number}</span>
            {project.client?.name ? `${project.client.name} · ` : ""}{project.name}
          </h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">{SERVICE_LABELS[project.serviceType]}</span>
          {project.status === "CLOSED" && (
            <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-700">закрыт</span>
          )}
          <span className="ml-auto">
            {project.status === "ACTIVE" ? (
              <form action={closeProject.bind(null, project.id)}>
                <button
                  disabled={inFlight > 0}
                  title={inFlight > 0 ? `Нельзя закрыть: ${inFlight} заявок в работе` : "Закрыть проект"}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Закрыть проект
                </button>
              </form>
            ) : project.status === "CLOSED" ? (
              <form action={reopenProject.bind(null, project.id)}>
                <button className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                  Переоткрыть
                </button>
              </form>
            ) : null}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Продажник: {project.owner?.fullName ?? "—"} · Проджект: {project.projectManager?.fullName ?? "—"} · Леджер: {project.ledger.name}
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          Зарегистрирован {project.createdAt.toLocaleDateString("ru-RU")}
          {project.realizationDate ? ` · утверждён ${project.realizationDate.toLocaleDateString("ru-RU")}` : ""}
          {project.completionDate ? ` · план. завершение ${project.completionDate.toLocaleDateString("ru-RU")}` : ""}
        </p>
      </div>

      {overpaid && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          ⚠ Перевыплата относительно сметы: выплачено {formatTiyn(paidTotal)} при себестоимости {formatTiyn(current?.costAmount ?? 0n)}.
          Разберите с бухгалтерией/CFO (DECISIONS §1.1).
        </div>
      )}

      {/* Сводка */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Цена клиенту" value={current ? formatTiyn(gross) : "—"} />
        <Card label="Поступило" value={formatTiyn(receivedTotal)} accent={receivedTotal > 0n ? "text-green-700" : undefined} />
        <Card label="Дебиторка" value={receivable > 0n ? formatTiyn(receivable) : "—"} accent={receivable > 0n ? "text-amber-700" : undefined} />
        <Card label="Себестоимость" value={current ? formatTiyn(cost) : "—"} />
        <Card label="Выплачено" value={formatTiyn(paidTotal)} />
        <Card label="Баланс проекта" value={formatTiyn(balance)} accent={balance < 0n ? "text-red-600" : "text-green-700"} />
      </div>

      {/* Прогресс: клиент оплатил / получателям выплачено */}
      {current && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Progress label="Клиент оплатил" done={receivedTotal} total={gross} color="bg-green-500" />
          <Progress label="Выплачено получателям" done={paidTotal} total={cost} color="bg-indigo-500" />
        </div>
      )}

      {/* Смета */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-700">
            Смета {current ? `· версия ${versions[0]?.version ?? 1}` : "· не задана"}
          </h2>
          {current && (
            <span className="text-xs text-gray-400">
              НДС {formatTiyn(current.vatAmount)} · маржа {formatTiyn(current.marginAmount)}
              {current.depositAmount > 0n ? ` · продакшн-резерв ${formatTiyn(current.depositAmount)}` : ""}
            </span>
          )}
        </div>
        <div className="p-5">
          {current && (
            <table className="mb-4 w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {current.lines.map((l) => {
                  const discount = l.baseFee != null && l.baseFee > l.plannedAmount ? l.baseFee - l.plannedAmount : 0n;
                  return (
                    <tr key={l.id}>
                      <td className="py-1.5 text-gray-700">
                        {l.title}
                        {l.kind === "CATEGORY" && <span className="ml-2 text-xs text-gray-400">категория</span>}
                        {(l.customDeliverable || l.deliverables.length > 0) && (
                          <span className="ml-2 text-xs text-gray-400">
                            {l.customDeliverable ?? l.deliverables.map((d) => DELIVERABLE_LABELS[d]).join(", ")}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">
                        <span className="font-medium text-gray-900">{formatTiyn(l.plannedAmount)}</span>
                        {l.reserveAmount > 0n && (
                          <span className="ml-2 text-xs text-gray-500">+ резерв {formatTiyn(l.reserveAmount)}</span>
                        )}
                        {discount > 0n && (
                          <span className="ml-2 text-xs text-green-700" title={`Прайс по базе: ${formatTiyn(l.baseFee!)}`}>
                            скидка {formatTiyn(discount)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-indigo-600">
              {current ? "Изменить смету (новая версия)" : "+ Завести смету"}
            </summary>
            <div className="mt-4">
              <EstimateForm
                action={saveEstimate.bind(null, project.id)}
                versionNo={nextVersionNo}
                isInfluence={project.serviceType === "INFLUENCE"}
                initial={
                  current
                    ? {
                        clientPriceGross: tiynToInputString(current.clientPriceGross),
                        deposit: current.depositAmount > 0n ? tiynToInputString(current.depositAmount) : "",
                        lines: current.lines.map((l) => ({
                          title: l.title,
                          amount: tiynToInputString(l.plannedAmount),
                          isCategory: l.kind === "CATEGORY",
                        })),
                      }
                    : undefined
                }
              />
            </div>
          </details>
        </div>
      </section>

      {/* Получатели: план/факт */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-700">Получатели</h2>
          <span className="text-xs text-gray-400">оплачено {paidCount} / {recipients.length}</span>
        </div>
        {recipients.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">Получатели появятся из строк сметы.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-5 py-2 font-medium">Получатель</th>
                <th className="px-5 py-2 text-right font-medium">План</th>
                <th className="px-5 py-2 text-right font-medium">Выплачено</th>
                <th className="px-5 py-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2.5 text-gray-800">{r.name}</td>
                  <td className="px-5 py-2.5 text-right text-gray-700">{r.planned > 0n ? formatTiyn(r.planned) : "—"}</td>
                  <td className="px-5 py-2.5 text-right font-medium text-gray-900">{r.paid > 0n ? formatTiyn(r.paid) : "—"}</td>
                  <td className="px-5 py-2.5">
                    {r.isPaid ? (
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">оплачен</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600">к оплате</span>
                    )}
                    {r.paid > r.planned && r.planned > 0n && (
                      <span className="ml-2 text-xs text-red-600">перерасход</span>
                    )}
                    {!r.isPaid && project.status === "ACTIVE" && (
                      <Link
                        href={`/requests/new?projectId=${project.id}&recipientId=${r.id}`}
                        className="ml-3 text-xs font-medium text-indigo-600 hover:underline"
                      >
                        → Заявка на оплату
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Поступления от клиента */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-700">Поступления от клиента</h2>
          {gross > 0n && (
            <span className="text-xs text-gray-400">оплачено {Number((receivedTotal * 100n) / gross)}% от цены</span>
          )}
        </div>
        {project.incomings.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">
            Поступлений пока нет. Их регистрирует бухгалтерия (вручную или из банковской выписки).
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {project.incomings.map((inc) => (
                <tr key={inc.id}>
                  <td className="px-5 py-2.5 text-gray-600">{inc.receivedAt.toLocaleDateString("ru-RU")}</td>
                  <td className="px-5 py-2.5 text-gray-600">{inc.counterpartyName ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right font-medium text-gray-900">{formatTiyn(inc.amount)}</td>
                  <td className="px-5 py-2.5 text-right">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${INCOMING_STATUS_STYLES[inc.status]}`}>
                      {INCOMING_STATUS_LABELS[inc.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Заявки проекта */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-medium text-gray-700">Заявки по проекту</h2>
        </div>
        {project.paymentRequests.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">Заявок пока нет.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {project.paymentRequests.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5">
                    <Link href={`/requests/${r.id}`} className="font-medium text-indigo-600 hover:underline">{r.number}</Link>
                  </td>
                  <td className="px-5 py-2.5 text-gray-600">{r.recipient?.name ?? r.expenseType.name}</td>
                  <td className="px-5 py-2.5 text-right font-medium text-gray-900">{formatTiyn(r.amount)}</td>
                  <td className="px-5 py-2.5 text-xs text-gray-400">{r.createdAt.toLocaleDateString("ru-RU")}</td>
                  <td className="px-5 py-2.5"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* История версий сметы */}
      {versions.length > 1 && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-medium text-gray-700">История сметы</h2>
          <ul className="space-y-1.5 text-xs text-gray-500">
            {versions.map((v) => (
              <li key={v.id}>
                v{v.version} · {v.createdAt.toLocaleString("ru-RU")} · {v.createdBy.fullName} ·{" "}
                {REASON_LABELS[v.reason] ?? v.reason} · цена {formatTiyn(v.clientPriceGross)}, себест. {formatTiyn(v.costAmount)}
                {v.comment ? ` · «${v.comment}»` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}

// Прогресс-бар «сделано/всего» с процентом (обрезается на 100% ширины).
function Progress({ label, done, total, color }: { label: string; done: bigint; total: bigint; color: string }) {
  const pct = total > 0n ? Number((done * 100n) / total) : 0;
  const width = Math.min(pct, 100);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-gray-500">{label}</span>
        <span className={`font-medium ${pct >= 100 ? "text-green-700" : "text-gray-700"}`}>
          {formatTiyn(done)} / {formatTiyn(total)} · {pct}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
