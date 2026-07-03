import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/rbac";
import { getRequestForUser, getRequestFormData } from "@/lib/requests/queries";
import { updateRequest } from "@/lib/requests/actions";
import { RequestForm, type RequestInitial } from "../../new/RequestForm";
import { toDateInputValue } from "@/lib/requests/urgency";
import { tiynToInputString as tiynToInput } from "@/lib/money";

export default async function EditRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const req = await getRequestForUser(user, id);
  if (!req) notFound();

  // Редактировать может только автор и только черновик / на доработке.
  const editable = req.createdById === user.id && (req.status === "DRAFT" || req.status === "CLARIFICATION");
  if (!editable) redirect(`/requests/${id}`);

  const { expenseTypes, projects } = await getRequestFormData(user);

  const initial: RequestInitial = {
    expenseTypeId: req.expenseTypeId,
    projectId: req.projectId ?? "",
    recipientId: req.recipientId ?? "",
    estimateLineId: req.estimateLineId ?? "",
    amount: tiynToInput(req.amount),
    contractAmount: tiynToInput(req.contractAmount),
    paymentPercent: req.paymentPercent != null ? String(req.paymentPercent) : "",
    paymentTiming: req.paymentTiming ?? "",
    serviceRendered: req.serviceRendered,
    deliverables: req.deliverables,
    purpose: req.purpose ?? "",
    urgency: req.urgency,
    desiredPayDate: req.desiredPayDate ? toDateInputValue(req.desiredPayDate) : "",
    comment: req.comment ?? "",
  };

  const clarification =
    req.status === "CLARIFICATION"
      ? [...req.approvals].reverse().find((a) => a.decision === "CLARIFICATION_REQUESTED")
      : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href={`/requests/${id}`} className="text-sm text-gray-500 hover:underline">
          ← К заявке {req.number}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Редактирование заявки {req.number}</h1>
      </div>

      {clarification && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm">
          <p className="font-medium text-orange-800">Возвращена на доработку</p>
          <p className="mt-1 text-orange-700">
            {clarification.approver.fullName}: «{clarification.comment || "без комментария"}»
          </p>
        </div>
      )}

      <RequestForm
        expenseTypes={expenseTypes}
        projects={projects}
        action={updateRequest.bind(null, id)}
        initial={initial}
        existingAttachments={req.attachments.map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName }))}
      />
    </div>
  );
}
