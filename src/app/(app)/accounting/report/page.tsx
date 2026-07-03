import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { getFinancialReport } from "@/lib/accounting/report";
import { formatTiyn } from "@/lib/money";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const user = await requireRole("TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const sp = await searchParams;
  const year = Number(sp.y) || new Date().getFullYear();
  const r = await getFinancialReport(user.entityId, year);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <Link href="/accounting" className="text-sm text-gray-500 hover:underline">← Учёт</Link>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Ежемесячный отчёт · {r.year}</h1>
        <p className="text-sm text-gray-500">Автоматизация ручного отчёта бухгалтерии.</p>
        <div className="mt-2 flex gap-2 text-xs">
          <Link href={`/accounting/report?y=${r.year - 1}`} className="rounded-full bg-gray-100 px-3 py-1 text-gray-600 hover:bg-gray-200">← {r.year - 1}</Link>
          <Link href={`/accounting/report?y=${r.year + 1}`} className="rounded-full bg-gray-100 px-3 py-1 text-gray-600 hover:bg-gray-200">{r.year + 1} →</Link>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-800">Поступления</div>
        <Row label="Оборот с НДС" value={r.incomings.turnoverGross} />
        <Row label="Оборот без НДС" value={r.incomings.turnoverNet} />
        <Row label="НДС (→ 3098)" value={r.incomings.vat} />
        <Row label="Себестоимость (→ 7366)" value={r.incomings.cost} />
        <Row label="Маржа (на 6890)" value={r.incomings.margin} highlight />
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-800">Расходы</div>
        <Row label="Расходы себестоимости (7366)" value={r.expenses.costSpend} />
        <Row label="Офисные расходы (6890)" value={r.expenses.officeSpend} />
        <Row label="Спецпроекты (0175)" value={r.expenses.specSpend} />
      </section>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: bigint; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2.5 text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={`font-medium ${highlight ? "text-green-700" : "text-gray-900"}`}>{formatTiyn(value)}</span>
    </div>
  );
}
