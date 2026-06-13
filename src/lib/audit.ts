import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// Журнал аудита (CLAUDE.md §2, §12): каждое значимое изменение статуса/суммы.
// Кто, когда, что, комментарий + опциональный снапшот before/after.
export async function writeAudit(params: {
  entityId: string;
  userId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  comment?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      entityId: params.entityId,
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      comment: params.comment ?? null,
      metadata: params.metadata,
    },
  });
}
