// Конфиденциальность §10 — ЕДИНАЯ точка правила «кто видит проект».
// Используется списками, формами заявок и проверками сервисов: любой запрос
// проектов обязан фильтровать через projectScopeFilter (SQL, не UI).

import { canSeeEverything, hasRole } from "@/lib/auth/permissions";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { Prisma } from "@prisma/client";

// Проект видят: владелец (продажник), прикреплённый проджект, департамент
// владельца, а руководитель блока (роль APPROVER) — ещё и проекты, которые
// ведут проджекты его департамента (например Рахима — все блогерские).
// CFO/бухгалтерия (canSeeEverything) видят всё.
export function projectScopeFilter(user: AuthenticatedUser): Prisma.ProjectWhereInput {
  if (canSeeEverything(user)) return {};
  const or: Prisma.ProjectWhereInput[] = [
    { ownerUserId: user.id },
    { projectManagerId: user.id },
    { departmentId: user.departmentId ?? "__none__" },
  ];
  if (hasRole(user, "APPROVER")) {
    or.push({ projectManager: { departmentId: user.departmentId ?? "__none__" } });
  }
  return { OR: or };
}
