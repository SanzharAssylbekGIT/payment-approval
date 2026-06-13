import type { LedgerKind, ServiceType, IncomingStatus } from "@prisma/client";

export const LEDGER_LABELS: Record<LedgerKind, string> = {
  COST_7366: "Себестоимость проектов (7366)",
  DEPOSIT_INFLUENCE: "Депозит продакшна (Influence)",
  RESERVE_COMMERCIAL: "Резерв ком. продакшна (Video/Photo)",
  SPECPROJECT_0175: "Спецпроекты (0175)",
};

export const SERVICE_LABELS: Record<ServiceType, string> = {
  INFLUENCE: "Influence marketing",
  VIDEO_PHOTO: "Video/Photo production",
  EVENT: "Event",
  SPEC_PROJECT: "Spec project",
};

export const INCOMING_STATUS_LABELS: Record<IncomingStatus, string> = {
  UNALLOCATED: "Не разнесено",
  PARTIALLY_ALLOCATED: "Разнесено частично",
  ALLOCATED: "Разнесено",
};

export const INCOMING_STATUS_STYLES: Record<IncomingStatus, string> = {
  UNALLOCATED: "bg-amber-50 text-amber-700",
  PARTIALLY_ALLOCATED: "bg-orange-50 text-orange-700",
  ALLOCATED: "bg-green-50 text-green-700",
};
