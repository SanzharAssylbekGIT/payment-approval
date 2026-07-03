import type { RequestStatus, Urgency } from "@prisma/client";
import { STATUS_LABELS, STATUS_STYLES, URGENCY_LABELS, URGENCY_STYLES } from "@/lib/requests/status";

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${URGENCY_STYLES[urgency]}`}>
      {URGENCY_LABELS[urgency]}
    </span>
  );
}
