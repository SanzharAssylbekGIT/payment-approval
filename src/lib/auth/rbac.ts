import { redirect } from "next/navigation";
import type { RoleName } from "@prisma/client";
import { getCurrentUser } from "./session";
import type { AuthenticatedUser } from "./types";
import { hasRole } from "./permissions";

// Серверные guard'ы (используют сессию/redirect). Чистые помощники RBAC/навигации
// живут в ./permissions и реэкспортируются ниже для обратной совместимости.

// Требует залогиненного пользователя, иначе редирект на /login.
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// Требует одну из ролей, иначе редирект на дашборд (нет доступа).
export async function requireRole(...roles: RoleName[]): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!hasRole(user, ...roles)) redirect("/dashboard");
  return user;
}

export { hasRole, canSeeEverything, visibleNav, NAV_ITEMS, ROLE_LABELS } from "./permissions";
export type { NavItem } from "./permissions";
