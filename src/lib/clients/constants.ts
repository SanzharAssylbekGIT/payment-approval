// Справочные константы карточки клиента: формы компаний, банки второго уровня
// Казахстана, автоматический расчёт КБЕ. Используется и формой (client), и
// серверным действием — без зависимостей от Prisma.

export const COMPANY_FORMS = [
  { value: "IP", label: "ИП" },
  { value: "TOO", label: "ТОО" },
  { value: "AO", label: "АО" },
  { value: "CHK", label: "ЧК (частная компания)" },
] as const;

export type CompanyFormValue = (typeof COMPANY_FORMS)[number]["value"];

export const COMPANY_FORM_LABELS: Record<CompanyFormValue, string> = {
  IP: "ИП",
  TOO: "ТОО",
  AO: "АО",
  CHK: "ЧК",
};

// Банки второго уровня РК (для дропдауна реквизитов). Если банка нет в списке
// (иностранный и т.п.) — в форме есть «Другой банк» со свободным вводом.
export const KZ_BANKS = [
  "Халык Банк (Народный банк Казахстана)",
  "Kaspi Bank",
  "Банк ЦентрКредит",
  "ForteBank",
  "Jusan Bank",
  "Евразийский банк",
  "Bank RBK",
  "Freedom Bank Kazakhstan",
  "Bereke Bank",
  "Отбасы банк",
  "Home Credit Bank",
  "Altyn Bank",
  "Нурбанк",
  "Ситибанк Казахстан",
  "Банк Китая в Казахстане",
  "Торгово-промышленный банк Китая в г. Алматы (ICBC)",
  "Шинхан Банк Казахстан",
  "КЗИ Банк",
  "Заман-Банк",
  "Al Hilal Банк",
  "ВТБ (Казахстан)",
] as const;

// КБЕ (код бенефициара): первая цифра — резидентство (1 резидент / 2 нерезидент),
// вторая — сектор экономики: 9 — ИП и домашние хозяйства, 7 — негосударственные
// нефинансовые организации (ТОО/АО/ЧК). Считается системой, руками не вводится.
export function kbeFor(form: CompanyFormValue, isForeign: boolean): string {
  const residency = isForeign ? "2" : "1";
  const sector = form === "IP" ? "9" : "7";
  return residency + sector;
}

export function kbeDescription(form: CompanyFormValue, isForeign: boolean): string {
  return `${kbeFor(form, isForeign)} — ${isForeign ? "нерезидент" : "резидент"}, ${form === "IP" ? "ИП" : "юрлицо"}`;
}
