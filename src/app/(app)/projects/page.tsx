import Link from "next/link";
import { requireRole, canSeeEverything, hasRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getProjectsByService } from "@/lib/projects/queries";
import { nextProjectNumber } from "@/lib/projects/numbering";
import { projectCode } from "@/lib/projects/code";
import { formatTiyn, tiynToInputString } from "@/lib/money";
import { NewDealForm, type BloggerOpt } from "./NewDealForm";
import type { ServiceType } from "@prisma/client";

// Вкладки по видам услуг (DECISIONS §13.6).
const TABS: { key: string; label: string; service: ServiceType }[] = [
  { key: "bloggers", label: "Блогеры", service: "INFLUENCE" },
  { key: "production", label: "Продакшн", service: "VIDEO_PHOTO" },
  { key: "events", label: "Ивенты", service: "EVENT" },
  { key: "spec", label: "Спецпроекты", service: "SPEC_PROJECT" },
];

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; arch?: string }>;
}) {
  const user = await requireRole("ACCOUNT_MANAGER", "PROJECT_MANAGER", "TREASURY_BOARD", "TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const sp = await searchParams;
  const seeAll = canSeeEverything(user);

  // Вкладка «Спецпроекты» видна только финансам и департаменту-исполнителю
  // (§18) — остальным она по скоупу всегда пустая, поэтому не показываем вовсе.
  const specType = await prisma.expenseType.findFirst({
    where: { entityId: user.entityId, code: "SPEC_PROJECT", isActive: true },
    select: { departmentId: true },
  });
  const specVisible = seeAll || (!!user.departmentId && user.departmentId === specType?.departmentId);
  const tabs = TABS.filter((t) => t.service !== "SPEC_PROJECT" || specVisible);
  const active = tabs.find((t) => t.key === sp.tab) ?? tabs[0];
  const showClosed = sp.arch === "1";

  const projects = await getProjectsByService(user, active.service, showClosed);

  // Итоги по вкладке.
  const totals = projects.reduce(
    (t, p) => ({
      gross: t.gross + p.clientPriceGross,
      received: t.received + p.receivedTotal,
      paid: t.paid + p.paidTotal,
      receivable: t.receivable + p.receivable,
    }),
    { gross: 0n, received: 0n, paid: 0n, receivable: 0n },
  );
  // Кто создаёт проекты (DECISIONS §14/§17/§18):
  // Блогеры/Продакшн/Ивенты — продажники (ACCOUNT_MANAGER) и финансы;
  // Спецпроекты — исполнитель направления (департамент вида расхода
  // SPEC_PROJECT, т.е. Айсулу) и финансы. Продажники спец НЕ создают.
  // Коллегия (TREASURY_BOARD) смотрит, но не создаёт.
  const canCreate =
    active.service === "SPEC_PROJECT"
      ? seeAll || (!!user.departmentId && user.departmentId === specType?.departmentId)
      : seeAll || hasRole(user, "ACCOUNT_MANAGER");

  const [clientOptions, pmOptions, bloggerRows, ownerOptions, nextNumber] = await Promise.all([
    prisma.client.findMany({ where: { entityId: user.entityId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { entityId: user.entityId, isActive: true, roles: { some: { role: "PROJECT_MANAGER" } } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    active.service === "INFLUENCE"
      ? prisma.blogger.findMany({
          where: { entityId: user.entityId, isActive: true },
          include: { prices: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    seeAll
      ? prisma.user.findMany({
          where: { entityId: user.entityId, isActive: true, roles: { some: { role: "ACCOUNT_MANAGER" } } },
          orderBy: { fullName: "asc" },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
    nextProjectNumber(user.entityId, active.service),
  ]);

  // BigInt-прайсы → строки тенге для клиентского компонента. Прайс для
  // сделки/скидки — себес С НАЛОГОМ (DECISIONS §14.4).
  const bloggers: BloggerOpt[] = bloggerRows.map((b) => ({
    id: b.id,
    name: b.name,
    link: b.link,
    options: b.prices
      .slice()
      .sort((x, y) => x.name.localeCompare(y.name, "ru"))
      .map((p) => ({ name: p.name, kind: p.kind, priceWithTax: tiynToInputString(p.priceWithTax) })),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Проекты</h1>
        <p className="mt-1 text-sm text-gray-500">
          {seeAll ? "Все проекты компании" : "Ваши проекты и проекты вашего блока"} · сделка, смета, статусы оплат
        </p>
      </div>

      {/* Вкладки видов услуг */}
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/projects?tab=${t.key}${showClosed ? "&arch=1" : ""}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              t.key === active.key ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
        <Link
          href={`/projects?tab=${active.key}${showClosed ? "" : "&arch=1"}`}
          className="ml-auto text-xs text-gray-500 hover:underline"
        >
          {showClosed ? "Скрыть закрытые" : "Показать закрытые"}
        </Link>
      </div>

      {/* Итоги по вкладке */}
      {projects.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TotalCard label="Сумма сделок" value={formatTiyn(totals.gross)} />
          <TotalCard label="Поступило от клиентов" value={formatTiyn(totals.received)} />
          <TotalCard label="Выплачено" value={formatTiyn(totals.paid)} />
          <TotalCard label="Дебиторка" value={formatTiyn(totals.receivable)} accent={totals.receivable > 0n ? "text-amber-700" : "text-green-700"} />
        </div>
      )}

      {canCreate && (
        <NewDealForm
          projectManagers={pmOptions}
          clients={clientOptions}
          bloggers={bloggers}
          owners={ownerOptions}
          service={active.service}
          nextNumber={nextNumber}
        />
      )}

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          В разделе «{active.label}» {showClosed ? "нет проектов" : "нет активных проектов"}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">№</th>
                <th className="px-4 py-2.5 font-medium">Проект</th>
                <th className="px-4 py-2.5 font-medium">Клиент</th>
                <th className="px-4 py-2.5 text-right font-medium">Цена клиенту</th>
                <th className="px-4 py-2.5 text-right font-medium">Поступило</th>
                <th className="px-4 py-2.5 text-right font-medium">Дебиторка</th>
                <th className="px-4 py-2.5 font-medium">Получатели</th>
                <th className="px-4 py-2.5 text-right font-medium">Выплачено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{projectCode(active.service, p.number)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                      {p.name}
                    </Link>
                    {!p.hasEstimate && <span className="ml-2 text-xs text-amber-600">нет сметы</span>}
                    {p.status !== "ACTIVE" && <span className="ml-2 text-xs text-gray-400">({p.status === "CLOSED" ? "закрыт" : "отменён"})</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{p.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{p.hasEstimate ? formatTiyn(p.clientPriceGross) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={p.receivedTotal > 0n ? "text-green-700" : "text-gray-400"}>{formatTiyn(p.receivedTotal)}</span>
                    {p.clientPriceGross > 0n && (
                      <span className="ml-1 text-xs text-gray-400">
                        {Number((p.receivedTotal * 100n) / p.clientPriceGross)}%
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {p.receivable > 0n ? (
                      <span className="font-medium text-amber-700">{formatTiyn(p.receivable)}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={p.recipientsTotal > 0 && p.recipientsPaid === p.recipientsTotal ? "text-green-700" : "text-gray-700"}>
                      оплачено {p.recipientsPaid} / {p.recipientsTotal}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{formatTiyn(p.paidTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TotalCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${accent ?? "text-gray-900"}`}>{value}</p>
    </div>
  );
}
