import Link from "next/link";
import { requireRole, canSeeEverything, hasRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getProjectsByService } from "@/lib/projects/queries";
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireRole("ACCOUNT_MANAGER", "PROJECT_MANAGER", "TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
  const sp = await searchParams;
  const active = TABS.find((t) => t.key === sp.tab) ?? TABS[0];

  const projects = await getProjectsByService(user, active.service);
  const seeAll = canSeeEverything(user);
  // Заносить сделки могут продажники (ACCOUNT_MANAGER) и финансы; проджекты — только смотрят.
  const canCreate = seeAll || hasRole(user, "ACCOUNT_MANAGER");

  const [clientOptions, pmOptions, bloggerRows, ownerOptions] = await Promise.all([
    prisma.client.findMany({ where: { entityId: user.entityId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { entityId: user.entityId, isActive: true, roles: { some: { role: "PROJECT_MANAGER" } } },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
    prisma.blogger.findMany({
      where: { entityId: user.entityId, isActive: true },
      include: { prices: true },
      orderBy: { name: "asc" },
    }),
    seeAll
      ? prisma.user.findMany({
          where: { entityId: user.entityId, isActive: true, roles: { some: { role: "ACCOUNT_MANAGER" } } },
          orderBy: { fullName: "asc" },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
  ]);

  // BigInt-прайсы → строки тенге для клиентского компонента.
  const bloggers: BloggerOpt[] = bloggerRows.map((b) => ({
    id: b.id,
    name: b.name,
    prices: Object.fromEntries(b.prices.map((p) => [p.kind, tiynToInputString(p.price)])),
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
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/projects?tab=${t.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              t.key === active.key ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {canCreate && (
        <NewDealForm
          projectManagers={pmOptions}
          clients={clientOptions}
          bloggers={bloggers}
          owners={ownerOptions}
          defaultService={active.service}
        />
      )}

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          В разделе «{active.label}» пока нет проектов.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Проект</th>
                <th className="px-4 py-2.5 font-medium">Клиент</th>
                <th className="px-4 py-2.5 text-right font-medium">Цена клиенту</th>
                <th className="px-4 py-2.5 text-right font-medium">Себестоимость</th>
                <th className="px-4 py-2.5 font-medium">Получатели</th>
                <th className="px-4 py-2.5 text-right font-medium">Выплачено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p.id}`} className="font-medium text-indigo-600 hover:underline">
                      {p.name}
                    </Link>
                    {!p.hasEstimate && <span className="ml-2 text-xs text-amber-600">нет сметы</span>}
                    {p.status !== "ACTIVE" && <span className="ml-2 text-xs text-gray-400">({p.status === "CLOSED" ? "закрыт" : "отменён"})</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{p.clientName ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{p.hasEstimate ? formatTiyn(p.clientPriceGross) : "—"}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{p.hasEstimate ? formatTiyn(p.costAmount) : "—"}</td>
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
