import "server-only";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import type { AuthenticatedUser } from "./types";
import { SESSION_COOKIE_NAME, SESSION_TTL_DAYS } from "./constants";

const SESSION_COOKIE = SESSION_COOKIE_NAME;

// Создаёт сессию в БД и ставит httpOnly-cookie. Слой не зависит от способа
// аутентификации (credentials/SSO) — токен живёт одинаково.
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({ data: { userId, token, expiresAt } });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

// Завершает текущую сессию: удаляет запись и cookie.
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
    store.delete(SESSION_COOKIE);
  }
}

// Возвращает текущего пользователя или null. Используется в RSC/Server Actions.
// Истёкшую сессию чистит.
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { roles: true } } },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }

  const u = session.user;
  if (!u.isActive) return null;

  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    entityId: u.entityId,
    departmentId: u.departmentId,
    roles: u.roles.map((r) => r.role),
  };
}
