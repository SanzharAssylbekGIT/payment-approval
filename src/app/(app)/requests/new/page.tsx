import Link from "next/link";
import { requireUser } from "@/lib/auth/rbac";
import { getRequestFormData } from "@/lib/requests/queries";
import { RequestForm } from "./RequestForm";

export default async function NewRequestPage() {
  const user = await requireUser();
  const { expenseTypes, projects } = await getRequestFormData(user);

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
        <RequestForm expenseTypes={expenseTypes} projects={projects} />
      )}
    </div>
  );
}
