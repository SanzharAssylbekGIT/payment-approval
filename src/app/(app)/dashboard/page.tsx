import Link from "next/link";
import { requireUser, visibleNav, canSeeEverything, ROLE_LABELS } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";

export default async function DashboardPage() {
  const user = await requireUser();
  const seeAll = canSeeEverything(user);

  // Конфиденциальность: заявитель видит только свои заявки. Полные счётчики —
  // только тем, кто «видит всё» (CFO/бухгалтерия).
  const myRequests = await prisma.paymentRequest.count({
    where: { entityId: user.entityId, createdById: user.id },
  });

  const stats = seeAll
    ? {
        projects: await prisma.project.count({ where: { entityId: user.entityId } }),
        pending: await prisma.paymentRequest.count({
          where: { entityId: user.entityId, status: "PENDING_APPROVAL" },
        }),
        expenseTypes: await prisma.expenseType.count({ where: { entityId: user.entityId } }),
      }
    : null;

  const cards = visibleNav(user).filter((i) => i.href !== "/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">
          Здравствуйте, {user.fullName.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Роли: {user.roles.map((r) => ROLE_LABELS[r]).join(", ")}
        </p>
      </div>

      {/* Быстрые счётчики */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Мои заявки" value={myRequests} />
        {stats && <Stat label="Проектов" value={stats.projects} />}
        {stats && <Stat label="На согласовании" value={stats.pending} />}
        {stats && <Stat label="Видов расходов" value={stats.expenseTypes} />}
      </div>

      {/* Разделы */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Разделы</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-xl border border-gray-200 bg-white p-4 text-sm font-medium text-gray-800 shadow-sm hover:border-indigo-300 hover:shadow"
            >
              {c.label} →
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
