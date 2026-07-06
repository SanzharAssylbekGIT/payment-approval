import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { formatTiyn } from "@/lib/money";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectPeek } from "@/components/ProjectPeek";
import { MarkPaidForm } from "./MarkPaidForm";

export default async function PaymentsPage() {
  const user = await requireRole("ACCOUNTANT", "CHIEF_ACCOUNTANT");

  // Только заявки ИЗ РЕЕСТРА: жизненный цикл §12 — «В реестре» → «Оплачена».
  // Оплата APPROVED-заявки в обход решения казначейства из UI недоступна
  // (банковский импорт — отдельный путь, там факт списания первичен).
  const toPay = await prisma.paymentRequest.findMany({
    where: { entityId: user.entityId, status: "IN_REGISTER" },
    include: { expenseType: true, project: { include: { client: true } }, recipient: true },
    orderBy: [{ desiredPayDate: "asc" }],
  });

  const recentlyPaid = await prisma.paymentRequest.findMany({
    where: { entityId: user.entityId, status: "PAID" },
    include: { expenseType: true, project: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Оплаты</h1>
        <p className="mt-1 text-sm text-gray-500">
          Отметка «оплачено» по факту списания. После отметки выплата автоматически отражается в учёте.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">К оплате</h2>
        {toPay.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            Нет заявок к оплате. Казначей формирует реестр в разделе «Казначейство».
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Заявка</th>
                  <th className="px-4 py-2.5 font-medium">Вид / проект / получатель</th>
                  <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                  <th className="px-4 py-2.5 font-medium">Статус</th>
                  <th className="px-4 py-2.5 text-right font-medium">Дата списания</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {toPay.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link href={`/requests/${r.id}`} className="font-medium text-indigo-600 hover:underline">{r.number}</Link>
                    </td>
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
                      {r.recipient ? ` → ${r.recipient.name}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{formatTiyn(r.amount)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3"><MarkPaidForm requestId={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {recentlyPaid.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-gray-700">Недавно оплачено</h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {recentlyPaid.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5">
                      <Link href={`/requests/${r.id}`} className="font-medium text-indigo-600 hover:underline">{r.number}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {r.expenseType.name}
                      {r.project && (
                        <>
                          {" · "}
                          <ProjectPeek projectId={r.project.id} className="inline text-left text-gray-600 hover:text-indigo-600 hover:underline">
                            {r.project.name}
                          </ProjectPeek>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-gray-900">{formatTiyn(r.amount)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
