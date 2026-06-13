// Казначейство: реестр на оплату и отметка «оплачено». Логика отделена от
// транспорта (как в requests/service). Явный user-параметр → тестируемо.

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hasRole } from "@/lib/auth/permissions";
import { postRequestPayout } from "@/lib/accounting/posting";
import type { AuthenticatedUser } from "@/lib/auth/types";

export class TreasuryError extends Error {}

// Включить одобренную заявку в реестр на оплату (решение казначея/коллегии).
// Одобрена → В реестре на оплату (CLAUDE.md §12).
export async function addToRegister(user: AuthenticatedUser, requestId: string) {
  if (!hasRole(user, "TREASURER_CFO", "TREASURY_BOARD")) throw new TreasuryError("Нет прав казначея");
  const req = await prisma.paymentRequest.findFirst({ where: { id: requestId, entityId: user.entityId } });
  if (!req) throw new TreasuryError("Заявка не найдена");
  if (req.status !== "APPROVED") throw new TreasuryError("В реестр попадают только одобренные заявки");

  await prisma.paymentRequest.update({ where: { id: requestId }, data: { status: "IN_REGISTER" } });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "ADDED_TO_REGISTER", targetType: "PaymentRequest", targetId: requestId, comment: "Включена в реестр на оплату" });
}

// Убрать из реестра обратно в «Одобрена» (перенос на следующий период).
export async function removeFromRegister(user: AuthenticatedUser, requestId: string) {
  if (!hasRole(user, "TREASURER_CFO", "TREASURY_BOARD")) throw new TreasuryError("Нет прав казначея");
  const req = await prisma.paymentRequest.findFirst({ where: { id: requestId, entityId: user.entityId } });
  if (!req) throw new TreasuryError("Заявка не найдена");
  if (req.status !== "IN_REGISTER") throw new TreasuryError("Заявка не в реестре");

  await prisma.paymentRequest.update({ where: { id: requestId }, data: { status: "APPROVED" } });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "REMOVED_FROM_REGISTER", targetType: "PaymentRequest", targetId: requestId, comment: "Перенесена на следующий период" });
}

// Отметка «оплачено» — ТОЛЬКО бухгалтер, по факту списания (DECISIONS §3).
// Создаёт проводку выплаты (отражается в учёте Системы Б).
export async function markPaid(user: AuthenticatedUser, requestId: string, occurredAt: Date) {
  if (!hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT")) throw new TreasuryError("Отметить «оплачено» может только бухгалтер");
  const req = await prisma.paymentRequest.findFirst({ where: { id: requestId, entityId: user.entityId } });
  if (!req) throw new TreasuryError("Заявка не найдена");
  if (req.status !== "IN_REGISTER" && req.status !== "APPROVED") throw new TreasuryError("Оплатить можно только одобренную заявку из реестра");

  // Проводка выплаты + смена статуса в одной транзакции.
  await postRequestPayout(user, requestId, occurredAt);
  await prisma.paymentRequest.update({ where: { id: requestId }, data: { status: "PAID" } });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "MARKED_PAID", targetType: "PaymentRequest", targetId: requestId, comment: "Отмечена как оплаченная (по факту списания)" });
}
