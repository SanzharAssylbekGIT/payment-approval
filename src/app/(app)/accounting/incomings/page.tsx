import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getIncomings } from "@/lib/accounting/queries";
import { allocateIncoming } from "@/lib/accounting/actions";
import { formatTiyn } from "@/lib/money";
import { INCOMING_STATUS_LABELS, INCOMING_STATUS_STYLES } from "@/lib/accounting/labels";
import { IncomingForm } from "./IncomingForm";

export default async function IncomingsPage() {
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const incomings = await getIncomings();

  // Итоги по журналу (для строки «Итого»).
  const totals = incomings.reduce(
    (acc, i) => {
      acc.amount += i.amount;
      const a = i.allocations[0];
      if (a) { acc.vat += a.vatAmount; acc.cost += a.costAmount; acc.margin += a.marginAmount; }
      return acc;
    },
    { amount: 0n, vat: 0n, cost: 0n, margin: 0n },
  );

  // Проекты со сметой — для разнесения нужна смета.
  const projects = await prisma.project.findMany({
    where: { entityId: user.entityId, status: "ACTIVE" },
    include: { client: true, estimate: { include: { currentVersion: true } } },
    orderBy: { name: "asc" },
  });
  const projectOpts = projects.map((p) => ({
    id: p.id,
    label: `${p.client?.name ? p.client.name + " · " : ""}${p.name}${p.estimate?.currentVersion ? "" : " (без сметы)"}`,
  }));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Учёт</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Поступления от клиентов</h1>
        <p className="text-sm text-gray-500">Регистрация и разнос по смете (НДС → 3098, себестоимость → 7366, маржа остаётся).</p>
      </div>

      <IncomingForm projects={projectOpts} />

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Журнал поступлений и разнос</h2>
        {incomings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">Поступлений пока нет.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Дата поступл.</th>
                  <th className="px-3 py-2.5 font-medium">Клиент / проект</th>
                  <th className="px-3 py-2.5 text-right font-medium">Сумма</th>
                  <th className="px-3 py-2.5 text-right font-medium">НДС → 3098</th>
                  <th className="px-3 py-2.5 text-right font-medium">Себест. → 7366</th>
                  <th className="px-3 py-2.5 text-right font-medium">Маржа (6890)</th>
                  <th className="px-3 py-2.5 font-medium">Дата разноса</th>
                  <th className="px-3 py-2.5 font-medium">Статус</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incomings.map((i) => {
                  const a = i.allocations[0];
                  return (
                    <tr key={i.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-500">{i.receivedAt.toLocaleDateString("ru-RU")}</td>
                      <td className="px-3 py-2.5 text-gray-700">{i.project?.client?.name ? `${i.project.client.name} · ` : ""}{i.project?.name ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right font-medium text-gray-900">{formatTiyn(i.amount)}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{a ? formatTiyn(a.vatAmount) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{a ? formatTiyn(a.costAmount) : "—"}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{a ? formatTiyn(a.marginAmount) : "—"}</td>
                      <td className="px-3 py-2.5 text-gray-500">{a ? a.postedAt.toLocaleDateString("ru-RU") : "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INCOMING_STATUS_STYLES[i.status]}`}>{INCOMING_STATUS_LABELS[i.status]}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {i.status === "UNALLOCATED" && (
                          <form action={allocateIncoming.bind(null, i.id)}>
                            <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Разнести по смете</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-medium text-gray-900">
                <tr>
                  <td className="px-3 py-2.5" colSpan={2}>Итого ({incomings.length})</td>
                  <td className="px-3 py-2.5 text-right">{formatTiyn(totals.amount)}</td>
                  <td className="px-3 py-2.5 text-right">{formatTiyn(totals.vat)}</td>
                  <td className="px-3 py-2.5 text-right">{formatTiyn(totals.cost)}</td>
                  <td className="px-3 py-2.5 text-right">{formatTiyn(totals.margin)}</td>
                  <td className="px-3 py-2.5" colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">Разнос: НДС → счёт 3098, себестоимость → 7366 (к проекту), маржа остаётся на 6890. Суммы — в тенге.</p>
      </section>
    </div>
  );
}
