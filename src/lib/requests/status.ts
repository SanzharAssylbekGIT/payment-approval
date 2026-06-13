import type { RequestStatus, Priority } from "@prisma/client";

// Подписи и цвета статусов заявки (жизненный цикл — CLAUDE.md §12).
export const STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: "Черновик",
  PENDING_APPROVAL: "На согласовании",
  CLARIFICATION: "Запрошено уточнение",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
  IN_REGISTER: "В реестре на оплату",
  PAID: "Оплачена",
  CANCELLED: "Отменена",
};

export const STATUS_STYLES: Record<RequestStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700",
  CLARIFICATION: "bg-orange-50 text-orange-700",
  APPROVED: "bg-green-50 text-green-700",
  REJECTED: "bg-red-50 text-red-700",
  IN_REGISTER: "bg-blue-50 text-blue-700",
  PAID: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-gray-100 text-gray-500",
};

// Приоритеты (CLAUDE.md §8).
export const PRIORITY_LABELS: Record<Priority, string> = {
  CRITICAL: "Критичный",
  RELATIONSHIP: "Удерживающий отношения",
  FLEXIBLE: "Гибкий",
};

export const PRIORITY_STYLES: Record<Priority, string> = {
  CRITICAL: "bg-red-50 text-red-700",
  RELATIONSHIP: "bg-amber-50 text-amber-700",
  FLEXIBLE: "bg-gray-100 text-gray-600",
};
