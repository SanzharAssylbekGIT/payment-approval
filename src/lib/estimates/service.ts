// Сметы: создание/версионирование + пересчёт разнесений (DECISIONS §1, §1.1).
// Смета — источник правды для разнесения поступлений. Любое изменение создаёт
// НОВУЮ версию (кто/когда/причина), после чего уже разнесённые поступления
// пере-разносятся пропорционально новой смете (ADJUSTMENT-проводки на дельты).

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { canSeeEverything, hasRole } from "@/lib/auth/permissions";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { EstimateChangeReason, Prisma } from "@prisma/client";

export class EstimateError extends Error {}

// НДС Казахстана 12% в цене: vat = gross × 12/112 (округление half-up до тиына).
export function vatFromGross(gross: bigint): bigint {
  return (gross * 12n + 56n) / 112n;
}

function proportion(value: bigint, num: bigint, den: bigint): bigint {
  if (den === 0n) return 0n;
  return (value * num) / den;
}

export interface EstimateLineInput {
  title: string;
  amountTiyn: bigint;
  isCategory: boolean; // категория себестоимости без конкретного получателя
}

export interface EstimateInput {
  clientPriceGrossTiyn: bigint;
  depositTiyn: bigint; // продакшн-бюджет (Influence) — часть себестоимости в депозит
  lines: EstimateLineInput[];
  reason: EstimateChangeReason;
  comment?: string | null;
}

// Проект в области видимости пользователя (владелец/департамент/«видит всё»).
export async function getScopedProject(user: AuthenticatedUser, projectId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      entityId: user.entityId,
      ...(canSeeEverything(user)
        ? {}
        : { OR: [{ ownerUserId: user.id }, { departmentId: user.departmentId ?? "__none__" }] }),
    },
    include: { ledger: true, client: true },
  });
}

// Создание новой версии сметы (v1 или ревизия) + пересчёт разнесений.
export async function saveEstimateVersion(user: AuthenticatedUser, projectId: string, input: EstimateInput) {
  if (!hasRole(user, "ACCOUNT_MANAGER", "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO")) {
    throw new EstimateError("Нет прав вести сметы");
  }
  const project = await getScopedProject(user, projectId);
  if (!project) throw new EstimateError("Проект не найден");

  const gross = input.clientPriceGrossTiyn;
  if (gross <= 0n) throw new EstimateError("Цена клиенту должна быть больше нуля");
  if (input.lines.length === 0) throw new EstimateError("Добавьте хотя бы одну строку себестоимости");
  for (const l of input.lines) {
    if (!l.title.trim()) throw new EstimateError("У каждой строки должно быть название");
    if (l.amountTiyn <= 0n) throw new EstimateError(`Строка «${l.title}»: сумма должна быть больше нуля`);
  }

  const vat = vatFromGross(gross);
  const net = gross - vat;
  const cost = input.lines.reduce((s, l) => s + l.amountTiyn, 0n);
  const margin = net - cost;
  if (cost > net) throw new EstimateError("Себестоимость больше цены без НДС — проверьте суммы");
  if (input.depositTiyn < 0n || input.depositTiyn > cost) {
    throw new EstimateError("Продакшн-бюджет (депозит) не может превышать себестоимость");
  }

  const result = await prisma.$transaction(async (db) => {
    // Смета проекта (одна, история — в версиях).
    let estimate = await db.estimate.findUnique({ where: { projectId: project.id } });
    if (!estimate) {
      estimate = await db.estimate.create({ data: { entityId: user.entityId, projectId: project.id } });
    }

    const last = await db.estimateVersion.findFirst({
      where: { estimateId: estimate.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const versionNo = (last?.version ?? 0) + 1;

    const version = await db.estimateVersion.create({
      data: {
        estimateId: estimate.id,
        version: versionNo,
        clientPriceGross: gross,
        clientPriceNet: net,
        vatAmount: vat,
        costAmount: cost,
        marginAmount: margin,
        depositAmount: input.depositTiyn,
        reason: versionNo === 1 ? "INITIAL" : input.reason,
        comment: input.comment ?? null,
        createdById: user.id,
      },
    });

    // Строки: для не-категорий находим/создаём получателя проекта по имени.
    for (const l of input.lines) {
      let recipientId: string | null = null;
      if (!l.isCategory) {
        const name = l.title.trim();
        const existing = await db.recipient.findFirst({ where: { projectId: project.id, name } });
        recipientId =
          existing?.id ??
          (
            await db.recipient.create({
              data: {
                entityId: user.entityId,
                projectId: project.id,
                name,
                kind: project.serviceType === "INFLUENCE" ? "BLOGGER" : "CONTRACTOR",
              },
            })
          ).id;
      }
      await db.estimateLine.create({
        data: {
          versionId: version.id,
          kind: l.isCategory ? "CATEGORY" : "RECIPIENT",
          title: l.title.trim(),
          plannedAmount: l.amountTiyn,
          recipientId,
        },
      });
    }

    await db.estimate.update({ where: { id: estimate.id }, data: { currentVersionId: version.id } });

    // Ревизия (v2+): пере-разнести уже полученные поступления по новой смете.
    if (versionNo > 1) {
      await recalcAllocations(db, user, project.id, project.ledger.kind === "SPECPROJECT_0175", version);
    }

    return version;
  });

  await writeAudit({
    entityId: user.entityId,
    userId: user.id,
    action: result.version === 1 ? "ESTIMATE_CREATED" : "ESTIMATE_REVISED",
    targetType: "Estimate",
    targetId: project.id,
    comment:
      result.version === 1
        ? `Смета v1: цена ${gross} тиын, себестоимость ${cost}`
        : `Смета v${result.version} (${input.reason}): цена ${gross} тиын, себестоимость ${cost}`,
  });

  return result;
}

type Db = Prisma.TransactionClient;

// Пересчёт разнесений под новую версию: на каждую дельту НДС/себестоимости —
// ADJUSTMENT-проводки; Allocation обновляется на новые части (DECISIONS §1.1).
async function recalcAllocations(
  db: Db,
  user: AuthenticatedUser,
  projectId: string,
  isSpec: boolean,
  version: { id: string; version: number; clientPriceGross: bigint; vatAmount: bigint; costAmount: bigint },
) {
  const allocations = await db.allocation.findMany({
    where: { incoming: { projectId } },
    include: { incoming: true },
  });
  if (allocations.length === 0) return;

  const mainCode = isSpec ? "0175" : "6890";
  const [mainAcc, vatAcc, costAcc] = await Promise.all([
    db.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: mainCode } } }),
    db.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: "3098" } } }),
    db.account.findUnique({ where: { entityId_code: { entityId: user.entityId, code: "7366" } } }),
  ]);
  if (!mainAcc || !vatAcc || !costAcc) throw new EstimateError("Не найдены счета для пересчёта");

  for (const a of allocations) {
    const P = a.incoming.amount;
    const newVat = proportion(version.vatAmount, P, version.clientPriceGross);
    const newCost = proportion(version.costAmount, P, version.clientPriceGross);
    const newMargin = P - newVat - newCost;
    const dVat = newVat - a.vatAmount;
    const dCost = newCost - a.costAmount;

    const base = {
      entityId: user.entityId,
      kind: "ADJUSTMENT" as const,
      occurredAt: new Date(),
      incomingId: a.incomingId,
      allocationId: a.id,
      description: `Пересчёт разнесения по смете v${version.version}`,
    };

    if (isSpec) {
      // Спецпроект: на 0175 живут P − НДС (cost+margin внутри). Меняется только НДС.
      if (dVat !== 0n) {
        await db.transaction.create({ data: { ...base, accountId: mainAcc.id, amount: -dVat, projectId } });
        await db.transaction.create({ data: { ...base, accountId: vatAcc.id, amount: dVat } });
      }
    } else {
      // Обычная услуга: 6890 держит маржу; 3098 — НДС; 7366 (с проектом) — себестоимость.
      const dMain = -(dVat + dCost);
      if (dMain !== 0n) await db.transaction.create({ data: { ...base, accountId: mainAcc.id, amount: dMain } });
      if (dVat !== 0n) await db.transaction.create({ data: { ...base, accountId: vatAcc.id, amount: dVat } });
      if (dCost !== 0n) await db.transaction.create({ data: { ...base, accountId: costAcc.id, amount: dCost, projectId } });
    }

    await db.allocation.update({
      where: { id: a.id },
      data: {
        vatAmount: newVat,
        costAmount: newCost,
        marginAmount: newMargin,
        ratioBps: Number((P * 10000n) / version.clientPriceGross),
        estimateVersionId: version.id,
      },
    });
  }
}
