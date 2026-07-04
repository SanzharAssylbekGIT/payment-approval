// Код проекта: у каждого направления своя нумерация и свой префикс
// (решение CFO 2026-07-04). Файл без серверных зависимостей — используется
// и в клиентских компонентах.

import type { ServiceType } from "@prisma/client";

export const PROJECT_CODE_PREFIX: Record<ServiceType, string> = {
  INFLUENCE: "IM", // блогеры (influence marketing)
  VIDEO_PHOTO: "PR", // продакшн
  EVENT: "EV", // ивенты
  SPEC_PROJECT: "SP", // спецпроекты
};

export function projectCode(serviceType: ServiceType, number: number): string {
  return `${PROJECT_CODE_PREFIX[serviceType]}-${number}`;
}
