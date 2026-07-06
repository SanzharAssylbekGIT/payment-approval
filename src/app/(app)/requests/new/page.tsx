import Link from "next/link";
import { requireUser } from "@/lib/auth/rbac";
import { getRequestFormData } from "@/lib/requests/queries";
import { createRequest } from "@/lib/requests/actions";
import { RequestForm, type RequestInitial } from "./RequestForm";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string; recipientId?: string }>;
}) {
  const user = await requireUser();
  const { expenseTypes, projects, budgetLines } = await getRequestFormData(user);
  const sp = await searchParams;

  // Префилл из карточки проекта («→ Заявка на оплату» у получателя):
  // проект/получатель выбраны, вид расхода — первый проектный подходящей услуги.
  let initial: RequestInitial | undefined;
  if (sp.projectId) {
    const project = projects.find((p) => p.id === sp.projectId);
    if (project) {
      const et = expenseTypes.find((e) => e.isProjectCost && e.serviceType === project.serviceType);
      const recipient = sp.recipientId && project.recipients.some((r) => r.id === sp.recipientId) ? sp.recipientId : "";
      initial = {
        expenseTypeId: et?.id ?? "",
        projectId: project.id,
        recipientId: recipient,
        estimateLineId: "",
        estimateLineIds: [],
        budgetLineId: "",
        amount: "",
        contractAmount: "",
        paymentPercent: "",
        paymentTiming: "",
        serviceRendered: false,
        deliverables: [],
        purpose: "",
        urgency: et?.defaultUrgency ?? "NOT_URGENT",
        desiredPayDate: "",
        comment: "",
      };
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href="/requests" className="text-sm text-gray-500 hover:underline">
          ← К заявкам
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Новая заявка</h1>
      </div>

      {expenseTypes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Для вашего подразделения не настроены виды расходов. Обратитесь к администратору.
        </div>
      ) : (
        <RequestForm expenseTypes={expenseTypes} projects={projects} budgetLines={budgetLines} action={createRequest} initial={initial} />
      )}
    </div>
  );
}
