import type { RequestStatus, Urgency, PaymentTiming, AttachmentKind, BloggerDeliverable } from "@prisma/client";

// Код вида расхода «Гонорары блогеров» — особая форма заявки. Единственный
// источник константы для сервера и клиента (файл без серверных зависимостей).
export const BLOGGER_FEE_CODE = "BLOGGER_FEE";

// Подписи и цвета статусов заявки (жизненный цикл — CLAUDE.md §12).
export const STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: "Черновик",
  PENDING_APPROVAL: "На согласовании",
  CLARIFICATION: "На доработке",
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

// Срочность заявки (заменила приоритет). Дедлайн — в рабочих днях от подачи.
export const URGENCY_LABELS: Record<Urgency, string> = {
  URGENT: "Срочно",
  MEDIUM: "Средней срочности",
  NOT_URGENT: "Не срочно",
};

export const URGENCY_STYLES: Record<Urgency, string> = {
  URGENT: "bg-red-50 text-red-700",
  MEDIUM: "bg-amber-50 text-amber-700",
  NOT_URGENT: "bg-gray-100 text-gray-600",
};

// Минимум рабочих дней от подачи до желаемой даты оплаты (нижняя граница по
// срочности): «не срочно» нельзя просить раньше 5 р.д., «срочно» — от 1 р.д.
export const URGENCY_BUSINESS_DAYS: Record<Urgency, number> = {
  URGENT: 1,
  MEDIUM: 2,
  NOT_URGENT: 5,
};

export const URGENCY_HINTS: Record<Urgency, string> = {
  URGENT: "1 рабочий день",
  MEDIUM: "2–3 рабочих дня",
  NOT_URGENT: "5 рабочих дней",
};

// Момент оплаты (форма блогера).
export const PAYMENT_TIMING_LABELS: Record<PaymentTiming, string> = {
  PREPAY: "Предоплата",
  POSTPAY: "Постоплата",
};

// Категории вложений.
export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  CONTRACT: "Договор",
  INVOICE: "Счёт",
  ACT: "Акт выполненных работ",
  RESIDENCY_CERT: "Сертификат резидентства",
  OTHER: "Прочее",
};

// Форматы работ блогера (мультивыбор).
export const DELIVERABLE_LABELS: Record<BloggerDeliverable, string> = {
  STORY: "Сторис",
  STORY_SERIES: "Серия сторис",
  REELS: "Рилс",
  VIDEO_POST: "Видеопост",
  PHOTO_POST: "Фотопост",
  TIKTOK: "Тикток",
  YOUTUBE: "Ютуб",
  OTHER: "Прочее",
};

// Форматы, предлагаемые в смете сделки (DECISIONS §14).
export const DEAL_DELIVERABLES: BloggerDeliverable[] = ["STORY", "STORY_SERIES", "REELS", "PHOTO_POST", "TIKTOK", "OTHER"];
