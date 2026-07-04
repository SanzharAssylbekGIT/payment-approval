// Чистые помощники RBAC и навигации — БЕЗ серверных зависимостей (не тянут
// session.ts/"server-only"). Можно импортировать где угодно, в т.ч. в тестах.

import type { RoleName } from "@prisma/client";
import type { AuthenticatedUser } from "./types";

export function hasRole(user: AuthenticatedUser, ...roles: RoleName[]): boolean {
  return user.roles.some((r) => roles.includes(r));
}

// «Видит всё» — CFO и бухгалтерия (полная картина: все проекты/балансы/казначейство).
export function canSeeEverything(user: AuthenticatedUser): boolean {
  return hasRole(user, "TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT");
}

// --- Навигация по ролям ---
export interface NavItem {
  href: string;
  label: string;
  roles: RoleName[]; // пусто = виден всем авторизованным
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Главная", roles: [] },
  { href: "/projects", label: "Проекты", roles: ["ACCOUNT_MANAGER", "PROJECT_MANAGER", "TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT"] },
  { href: "/requests", label: "Мои заявки", roles: ["REQUESTER", "APPROVER", "ACCOUNT_MANAGER", "TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT"] },
  { href: "/approvals", label: "Согласование", roles: ["APPROVER", "CHIEF_ACCOUNTANT", "TREASURER_CFO"] },
  { href: "/treasury", label: "Казначейство", roles: ["TREASURER_CFO", "TREASURY_BOARD"] },
  { href: "/payments", label: "Оплаты", roles: ["ACCOUNTANT", "CHIEF_ACCOUNTANT"] },
  { href: "/accounting", label: "Учёт и дашборды", roles: ["TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT"] },
  { href: "/admin", label: "Админка", roles: ["ADMIN"] },
];

export function visibleNav(user: AuthenticatedUser): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.length === 0 || hasRole(user, ...item.roles));
}

export const ROLE_LABELS: Record<RoleName, string> = {
  REQUESTER: "Заявитель",
  APPROVER: "Согласующий",
  ACCOUNT_MANAGER: "Продажник (аккаунт)",
  PROJECT_MANAGER: "Проджект-менеджер",
  TREASURER_CFO: "Казначей / CFO",
  ACCOUNTANT: "Бухгалтер",
  CHIEF_ACCOUNTANT: "Главный бухгалтер",
  TREASURY_BOARD: "Казначейская коллегия",
  ADMIN: "Администратор",
};
