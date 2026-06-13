import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { toggleUserActive } from "@/lib/admin/actions";
import { CreateUserForm } from "./CreateUserForm";

export default async function AdminPage() {
  const admin = await requireRole("ADMIN");

  const [users, departments, expenseTypes] = await Promise.all([
    prisma.user.findMany({
      where: { entityId: admin.entityId },
      include: { roles: true, department: true },
      orderBy: { fullName: "asc" },
    }),
    prisma.department.findMany({ where: { entityId: admin.entityId }, orderBy: { name: "asc" } }),
    prisma.expenseType.findMany({
      where: { entityId: admin.entityId },
      include: { route: { include: { steps: { include: { approver: true }, orderBy: { order: "asc" } } } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Администрирование</h1>

      <CreateUserForm departments={departments.map((d) => ({ id: d.id, name: d.name }))} />

      {/* Пользователи */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Пользователи ({users.length})</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Имя</th>
                <th className="px-4 py-2.5 font-medium">Подразделение</th>
                <th className="px-4 py-2.5 font-medium">Роли</th>
                <th className="px-4 py-2.5 font-medium">Статус</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "opacity-50"}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-800">{u.fullName}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{u.department?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{u.roles.map((r) => ROLE_LABELS[r.role]).join(", ")}</td>
                  <td className="px-4 py-2.5">
                    {u.isActive ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">активен</span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">отключён</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {u.id !== admin.id && (
                      <form action={toggleUserActive.bind(null, u.id)}>
                        <button className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                          {u.isActive ? "Отключить" : "Включить"}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Виды расходов и маршруты */}
      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-700">Виды расходов и маршруты согласования</h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Вид расхода</th>
                <th className="px-4 py-2.5 font-medium">Счёт</th>
                <th className="px-4 py-2.5 font-medium">Маршрут согласования</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {expenseTypes.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2.5 text-gray-800">{e.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{accountCode(e.accountKind)}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {e.route && e.route.steps.length > 0
                      ? e.route.steps.map((s) => s.approver.fullName).join(" → ")
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-400">Редактирование маршрутов и видов расходов — следующий шаг админки.</p>
      </section>
    </div>
  );
}

function accountCode(kind: string): string {
  return { MAIN: "6890", PROJECT_COST: "7366", VAT: "3098", SPECPROJECT: "0175" }[kind] ?? kind;
}
