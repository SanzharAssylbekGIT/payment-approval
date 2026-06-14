import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";

export default async function ImportListPage() {
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const imports = await prisma.bankStatementImport.findMany({
    where: { entityId: user.entityId },
    include: { _count: { select: { lines: true } } },
    orderBy: { importedAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <div>
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Учёт</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Импорт банковской выписки</h1>
        <p className="text-sm text-gray-500">Загрузка выписки Kaspi → разбор → сверка поступлений и списаний.</p>
      </div>

      <UploadForm />

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Загруженные выписки</h2>
        {imports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Пока ничего не загружено.</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Счёт</th>
                  <th className="px-4 py-2.5 font-medium">Период</th>
                  <th className="px-4 py-2.5 font-medium">Операций</th>
                  <th className="px-4 py-2.5 font-medium">Баланс</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {imports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-800">{imp.accountCode ?? "?"}</td>
                    <td className="px-4 py-3 text-gray-600">{imp.periodFrom} – {imp.periodTo}</td>
                    <td className="px-4 py-3 text-gray-600">{imp._count.lines}</td>
                    <td className="px-4 py-3">
                      {imp.balanceOk === true ? <span className="text-green-700">✓ сошёлся</span> : imp.balanceOk === false ? <span className="text-red-600">✗ расхождение</span> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/accounting/import/${imp.id}`} className="text-sm font-medium text-indigo-600 hover:underline">Разобрать →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
