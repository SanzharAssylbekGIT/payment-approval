import type { Urgency } from "@prisma/client";
import { URGENCY_BUSINESS_DAYS } from "./status";

// Прибавляет n рабочих дней к дате (пропускает сб/вс). n=0 → та же дата.
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

// Минимально допустимая желаемая дата оплаты для срочности (локальная дата, 00:00).
export function minPayDateForUrgency(urgency: Urgency, from: Date = new Date()): Date {
  return addBusinessDays(from, URGENCY_BUSINESS_DAYS[urgency]);
}

// YYYY-MM-DD для <input type="date"> (в локальной зоне).
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
