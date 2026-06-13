import type { RoleName } from "@prisma/client";

// Пользователь, прошедший аутентификацию — то, что лежит в сессии и доступно
// в RSC/Server Actions. Содержит scope-поля для конфиденциальности (entityId,
// departmentId) и роли для RBAC.
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  entityId: string;
  departmentId: string | null;
  roles: RoleName[];
}

// Абстракция провайдера авторизации (CLAUDE.md §2): сейчас credentials,
// позже добавляется SSO-адаптер без переписывания вызывающего кода.
export interface AuthProviderAdapter {
  readonly id: "credentials" | "sso";
  // Проверка логина/пароля. Возвращает userId при успехе, null при отказе.
  // Для SSO этот метод не используется — там будет OAuth-callback + linkAccount.
  verifyCredentials?(email: string, password: string): Promise<string | null>;
}
