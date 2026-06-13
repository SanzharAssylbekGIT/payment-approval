"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RoleName } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/rbac";
import { hasRole } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit";

const ALL_ROLES: RoleName[] = ["REQUESTER", "APPROVER", "TREASURER_CFO", "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURY_BOARD", "ADMIN"];

const createUserSchema = z.object({
  email: z.string().email("Некорректный e-mail"),
  fullName: z.string().min(1, "Укажите имя"),
  position: z.string().optional(),
  departmentId: z.string().optional(),
  password: z.string().min(6, "Пароль минимум 6 символов"),
});

export type AdminState = { error?: string; ok?: boolean };

// Создание пользователя (только админ).
export async function createUser(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const user = await requireUser();
  if (!hasRole(user, "ADMIN")) return { error: "Нет прав администратора" };

  const parsed = createUserSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    position: formData.get("position") || undefined,
    departmentId: formData.get("departmentId") || undefined,
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };

  const roles = (formData.getAll("roles") as string[]).filter((r) => ALL_ROLES.includes(r as RoleName)) as RoleName[];
  if (roles.length === 0) return { error: "Выберите хотя бы одну роль" };

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (existing) return { error: "Пользователь с таким e-mail уже есть" };

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const created = await prisma.user.create({
    data: {
      entityId: user.entityId,
      email: parsed.data.email.toLowerCase(),
      fullName: parsed.data.fullName,
      position: parsed.data.position ?? null,
      departmentId: parsed.data.departmentId || null,
      passwordHash,
      roles: { create: roles.map((role) => ({ role })) },
    },
  });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "USER_CREATED", targetType: "User", targetId: created.id, comment: `Создан пользователь ${parsed.data.email}` });

  revalidatePath("/admin");
  return { ok: true };
}

// Включить/выключить пользователя (только админ). Себя — нельзя.
export async function toggleUserActive(userId: string): Promise<void> {
  const admin = await requireUser();
  if (!hasRole(admin, "ADMIN")) return;
  if (userId === admin.id) return;

  const target = await prisma.user.findFirst({ where: { id: userId, entityId: admin.entityId } });
  if (!target) return;
  await prisma.user.update({ where: { id: userId }, data: { isActive: !target.isActive } });
  await writeAudit({ entityId: admin.entityId, userId: admin.id, action: target.isActive ? "USER_DEACTIVATED" : "USER_ACTIVATED", targetType: "User", targetId: userId });
  revalidatePath("/admin");
}
