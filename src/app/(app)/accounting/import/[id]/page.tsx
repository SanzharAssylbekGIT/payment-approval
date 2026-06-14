import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { formatTiyn } from "@/lib/money";
import { confirmLinePaid } from "@/lib/import/actions";
import { IncomingFromLineForm } from "./IncomingFromLineForm";
import type { BankLineCategory } from "@prisma/client";

const CAT_LABELS: Record<BankLineCategory, string> = {
  CLIENT_INCOMING: "Поступления от клиентов",
  PROJECT_PAYOUT: "Списания (проекты / услуги)",
  SALARY: "Зарплата",
  INTERNAL_TRANSFER: "Внутренние переводы (исключаются)",
  NON_REVENUE: "Неклиентское (валюта / займы / возвраты)",
  OTHER: "Прочее",
};

export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");

  const imp = await prisma.bankStatementImport.findFirst({
    where: { id, entityId: user.entityId },
    include: { lines: { include: { matchedRequest: true, incoming: true }, orderBy: { occurredAt: "desc" } } },
  });
  if (!imp) notFound();

  const projects = await prisma.project.findMany({
    where: { entityId: user.entityId, status: "ACTIVE" },
    include: { client: true, estimate: { include: { currentVersion: true } } },
    orderBy: { name: "asc" },
  });
  const projectOpts = projects.map((p) => ({ id: p.id, label: `${p.client?.name ? p.client.name + " · " : ""}${p.name}` }));

  const byCat = (c: BankLineCategory) => imp.lines.filter((l) => l.category === c);
  const sum = (lines: typeof imp.lines) => lines.reduce((s, l) => s + l.amount, 0n);

  const incoming = byCat("CLIENT_INCOMING");
  const payouts = byCat("PROJECT_PAYOUT");
  const summaryCats: BankLineCategory[] = ["SALARY", "INTERNAL_TRANSFER", "NON_REVENUE", "OTHER"];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/accounting/import" className="text-sm text-gray-500 hover:underline">← Импорт выписок</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Выписка {imp.accountCode} · {imp.periodFrom} – {imp.periodTo}</h1>
        <p className="text-sm text-gray-500">
          {imp.lines.length} операций ·{" "}
          {imp.balanceOk === true ? <span className="text-green-700">баланс сошёлся ✓</span> : imp.balanceOk === false ? <span className="text-red-600">баланс не сошёлся ✗</span> : "—"}
          {imp.closingBalance != null && ` · исх. остаток ${formatTiyn(imp.closingBalance)}`}
        </p>
      </div>

      {/* Сводка по категориям */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(["CLIENT_INCOMING", "PROJECT_PAYOUT", "SALARY", "INTERNAL_TRANSFER", "NON_REVENUE"] as BankLineCategory[]).map((c) => {
          const lines = byCat(c);
          return (
            <div key={c} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-xs text-gray-500">{CAT_LABELS[c]}</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{formatTiyn(sum(lines))}</p>
              <p className="text-xs text-gray-400">{lines.length} оп.</p>
            </div>
          );
        })}
      </div>

      {/* Поступления */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Поступления от клиентов — привязать к проекту</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-3 py-2 font-medium">Дата</th><th className="px-3 py-2 font-medium">Плательщик</th><th className="px-3 py-2 text-right font-medium">Сумма</th><th className="px-3 py-2 font-medium">Действие</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {incoming.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-gray-500">{l.occurredAt.toLocaleDateString("ru-RU")}</td>
                  <td className="px-3 py-2 text-gray-700">{l.counterparty}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatTiyn(l.amount)}</td>
                  <td className="px-3 py-2">
                    {l.incoming || l.matched ? <span className="text-xs text-green-700">✓ поступление создано</span> : <IncomingFromLineForm lineId={l.id} projects={projectOpts} />}
                  </td>
                </tr>
              ))}
              {incoming.length === 0 && <tr><td colSpan={4} className="px-3 py-5 text-center text-sm text-gray-400">Нет поступлений</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Списания */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Списания — сопоставление с заявками ({payouts.length})</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-3 py-2 font-medium">Дата</th><th className="px-3 py-2 font-medium">Получатель</th><th className="px-3 py-2 font-medium">КНП</th><th className="px-3 py-2 text-right font-medium">Сумма</th><th className="px-3 py-2 font-medium">Заявка</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payouts.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2 text-gray-500">{l.occurredAt.toLocaleDateString("ru-RU")}</td>
                  <td className="px-3 py-2 text-gray-700">{l.counterparty}</td>
                  <td className="px-3 py-2 text-gray-400">{l.knp}</td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900">{formatTiyn(l.amount)}</td>
                  <td className="px-3 py-2">
                    {l.matched ? (
                      <span className="text-xs text-green-700">✓ оплачено</span>
                    ) : l.matchedRequest ? (
                      <form action={confirmLinePaid.bind(null, l.id)}>
                        <button className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">Отметить {l.matchedRequest.number}</button>
                      </form>
                    ) : (
                      <span className="text-xs text-gray-400">нет заявки</span>
                    )}
                  </td>
                </tr>
              ))}
              {payouts.length === 0 && <tr><td colSpan={5} className="px-3 py-5 text-center text-sm text-gray-400">Нет списаний</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-gray-400">«нет заявки» — за май в системе ещё нет соответствующих заявок (нормально для исторической загрузки). При работе вперёд списания будут авто-сопоставляться с заявками из реестра.</p>
      </section>

      {/* Прочие категории — сводно */}
      <section className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {summaryCats.map((c) => {
          const lines = byCat(c);
          if (lines.length === 0) return null;
          return (
            <div key={c} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
              <span className="text-gray-600">{CAT_LABELS[c]} <span className="text-gray-400">({lines.length})</span></span>
              <span className="font-medium text-gray-800">{formatTiyn(sum(lines))}</span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
