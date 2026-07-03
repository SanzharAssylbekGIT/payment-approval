import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { getRequestForUser, getRequestAudit } from "@/lib/requests/queries";
import { cancelRequest } from "@/lib/requests/actions";
import { formatTiyn } from "@/lib/money";
import { StatusBadge, UrgencyBadge } from "@/components/StatusBadge";
import { DELIVERABLE_LABELS, PAYMENT_TIMING_LABELS, ATTACHMENT_KIND_LABELS } from "@/lib/requests/status";
import { ApproverPanel } from "./ApproverPanel";
import { SubmitPanel } from "./SubmitPanel";

const DECISION_LABELS: Record<string, string> = {
  APPROVED: "Одобрено",
  REJECTED: "Отклонено",
  CLARIFICATION_REQUESTED: "Запрошено уточнение",
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const req = await getRequestForUser(user, id);
  if (!req) notFound();

  const audit = await getRequestAudit(user.entityId, id);
  const steps = req.expenseType.route?.steps ?? [];
  const isApprovedOrLater = ["APPROVED", "IN_REGISTER", "PAID"].includes(req.status);

  const isOwner = req.createdById === user.id;
  const currentStep = steps.find((s) => s.order === req.currentStepOrder);
  const isCurrentApprover = req.status === "PENDING_APPROVAL" && currentStep?.approverId === user.id;

  const canSubmit = isOwner && (req.status === "DRAFT" || req.status === "CLARIFICATION");
  const canEdit = canSubmit;
  const canCancel = isOwner && !["APPROVED", "IN_REGISTER", "PAID", "CANCELLED", "REJECTED"].includes(req.status);
  const isBloggerLike = req.contractAmount != null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/requests" className="text-sm text-gray-500 hover:underline">
          ← К заявкам
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Заявка {req.number}</h1>
          <StatusBadge status={req.status} />
        </div>
      </div>

      {/* Возвращена на доработку: показываем автору комментарий согласующего */}
      {req.status === "CLARIFICATION" && isOwner && (() => {
        const clarification = [...req.approvals].reverse().find((a) => a.decision === "CLARIFICATION_REQUESTED");
        return (
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm">
            <p className="font-medium text-orange-800">Заявка возвращена на доработку</p>
            {clarification && (
              <p className="mt-1 text-orange-700">
                {clarification.approver.fullName}: «{clarification.comment || "без комментария"}»
              </p>
            )}
            <p className="mt-1 text-xs text-orange-600">Отредактируйте заявку и отправьте её заново.</p>
          </div>
        );
      })()}

      {/* Действия согласующего */}
      {isCurrentApprover && <ApproverPanel id={req.id} />}

      {/* Детали */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-gray-200 bg-white p-6 text-sm">
        <Field label="Вид расхода" value={req.expenseType.name} />
        <Field label="Сумма" value={<span className="font-semibold">{formatTiyn(req.amount)}</span>} />
        <Field label="Срочность" value={<UrgencyBadge urgency={req.urgency} />} />
        <Field label="Желаемая дата оплаты" value={req.desiredPayDate ? req.desiredPayDate.toLocaleDateString("ru-RU") : "—"} />
        {req.project && <Field label="Проект" value={`${req.project.client?.name ? req.project.client.name + " · " : ""}${req.project.name}`} />}
        {req.recipient && <Field label={isBloggerLike ? "Блогер" : "Получатель"} value={req.recipient.name} />}
        {req.estimateLine && <Field label="Строка сметы" value={`${req.estimateLine.title} (план ${formatTiyn(req.estimateLine.plannedAmount)})`} />}
        {req.contractAmount != null && <Field label="Сумма по договору" value={formatTiyn(req.contractAmount)} />}
        {req.paymentPercent != null && <Field label="% от оплаты" value={`${req.paymentPercent}%`} />}
        {req.paymentTiming && <Field label="Оплата" value={PAYMENT_TIMING_LABELS[req.paymentTiming]} />}
        {isBloggerLike && <Field label="Услуга оказана" value={req.serviceRendered ? "Да" : "Нет"} />}
        {req.deliverables.length > 0 && (
          <div className="col-span-2">
            <Field label="Форматы работ" value={req.deliverables.map((d) => DELIVERABLE_LABELS[d]).join(", ")} />
          </div>
        )}
        <Field label="Автор" value={req.createdBy.fullName} />
        <div className="col-span-2">
          <Field label="Назначение платежа" value={req.purpose ?? "—"} />
        </div>
        {req.comment && (
          <div className="col-span-2">
            <Field label="Комментарий" value={req.comment} />
          </div>
        )}
        {req.attachments.length > 0 && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500">Вложения</p>
            <ul className="mt-1 space-y-1">
              {req.attachments.map((a) => (
                <li key={a.id} className="text-sm">
                  <span className="text-gray-500">{ATTACHMENT_KIND_LABELS[a.kind]}: </span>
                  <a href={`/requests/${req.id}/attachment/${a.id}`} className="text-indigo-600 hover:underline">
                    {a.fileName}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Действия автора */}
      {(canSubmit || canEdit || canCancel) && (
        <div className="flex gap-2">
          {canEdit && (
            <Link
              href={`/requests/${req.id}/edit`}
              className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Редактировать
            </Link>
          )}
          {canSubmit && <SubmitPanel id={req.id} />}
          {canCancel && (
            <form action={cancelRequest.bind(null, req.id)}>
              <button className="rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-700 hover:bg-gray-50">
                Отменить заявку
              </button>
            </form>
          )}
        </div>
      )}

      {/* Маршрут согласования */}
      {steps.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Маршрут согласования</h2>
          <ol className="space-y-2">
            {steps.map((s) => {
              const done = isApprovedOrLater || (req.status === "PENDING_APPROVAL" && s.order < req.currentStepOrder);
              const current = req.status === "PENDING_APPROVAL" && s.order === req.currentStepOrder;
              return (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                      done ? "bg-green-100 text-green-700" : current ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {done ? "✓" : s.order}
                  </span>
                  <span className={current ? "font-medium text-gray-900" : "text-gray-600"}>
                    {s.approver.fullName}
                  </span>
                  {current && <span className="text-xs text-amber-600">— сейчас здесь</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Решения по заявке */}
      {req.approvals.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Решения</h2>
          <ul className="space-y-2 text-sm">
            {req.approvals.map((a) => (
              <li key={a.id} className="flex flex-col border-l-2 border-gray-200 pl-3">
                <span className="text-gray-800">
                  <span className="font-medium">{a.approver.fullName}</span> — {DECISION_LABELS[a.decision]}
                </span>
                {a.comment && <span className="text-gray-500">«{a.comment}»</span>}
                <span className="text-xs text-gray-400">{a.decidedAt.toLocaleString("ru-RU")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Аудит */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-medium text-gray-700">Журнал</h2>
        <ul className="space-y-1.5 text-xs text-gray-500">
          {audit.map((log) => (
            <li key={log.id} className="flex gap-2">
              <span className="text-gray-400">{log.createdAt.toLocaleString("ru-RU")}</span>
              <span className="text-gray-700">{log.comment ?? log.action}</span>
              {log.user && <span className="text-gray-400">· {log.user.fullName}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-gray-800">{value}</p>
    </div>
  );
}
