// Импорт выписки: парсинг → категоризация → персист → матчинг списаний с заявками.
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { hasRole } from "@/lib/auth/permissions";
import type { AuthenticatedUser } from "@/lib/auth/types";
import type { BankLineCategory, BankLineDirection } from "@prisma/client";
import { parseKaspiStatement, KNP_INTERNAL_TRANSFER, KNP_NON_REVENUE, type ParsedStatementLine } from "./kaspi";

export class ImportError extends Error {}

const KNP_SALARY = "332";

// Категория строки по КНП и направлению.
function categorize(line: ParsedStatementLine): BankLineCategory {
  if (line.knp === KNP_INTERNAL_TRANSFER) return "INTERNAL_TRANSFER";
  if (KNP_NON_REVENUE[line.knp]) return "NON_REVENUE";
  if (line.knp === KNP_SALARY) return "SALARY";
  return line.direction === "CREDIT" ? "CLIENT_INCOMING" : "PROJECT_PAYOUT";
}

// Импорт выписки из буфера xlsx. Возвращает id импорта.
export async function importStatement(user: AuthenticatedUser, fileName: string, buf: Buffer): Promise<string> {
  if (!hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO")) throw new ImportError("Нет прав на импорт");

  const parsed = parseKaspiStatement(buf);
  if (parsed.lines.length === 0) throw new ImportError("Не удалось распознать операции — проверьте, что это выписка Kaspi (.xlsx)");

  // Проверка баланса: вх + кредиты − дебеты == исх.
  const credits = parsed.lines.filter((l) => l.direction === "CREDIT").reduce((s, l) => s + l.amountTiyn, 0n);
  const debits = parsed.lines.filter((l) => l.direction === "DEBIT").reduce((s, l) => s + l.amountTiyn, 0n);
  const balanceOk =
    parsed.openingBalanceTiyn != null && parsed.closingBalanceTiyn != null
      ? parsed.openingBalanceTiyn + credits - debits === parsed.closingBalanceTiyn
      : null;

  // Кандидаты для матчинга списаний: одобренные/в реестре заявки. Сопоставляем
  // по точной сумме; если такая сумма у нескольких — не матчим (неоднозначно).
  const candidates = await prisma.paymentRequest.findMany({
    where: { entityId: user.entityId, status: { in: ["IN_REGISTER", "APPROVED"] } },
    select: { id: true, amount: true },
  });
  const byAmount = new Map<string, string | null>();
  for (const c of candidates) {
    const key = c.amount.toString();
    byAmount.set(key, byAmount.has(key) ? null : c.id); // повтор → null (неоднозначно)
  }

  const imp = await prisma.bankStatementImport.create({
    data: {
      entityId: user.entityId,
      format: "EXCEL",
      fileName,
      accountCode: parsed.accountCode,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      openingBalance: parsed.openingBalanceTiyn,
      closingBalance: parsed.closingBalanceTiyn,
      balanceOk,
    },
  });

  await prisma.bankStatementLine.createMany({
    data: parsed.lines.map((l) => {
      const category = categorize(l);
      const matchedRequestId = l.direction === "DEBIT" && category === "PROJECT_PAYOUT" ? byAmount.get(l.amountTiyn.toString()) ?? null : null;
      return {
        importId: imp.id,
        direction: l.direction as BankLineDirection,
        amount: l.amountTiyn,
        occurredAt: l.occurredAt,
        docNumber: l.docNumber,
        counterparty: l.counterparty,
        iban: l.iban,
        knp: l.knp,
        purpose: l.purpose,
        category,
        matchedRequestId,
      };
    }),
  });

  await writeAudit({ entityId: user.entityId, userId: user.id, action: "STATEMENT_IMPORTED", targetType: "BankStatementImport", targetId: imp.id, comment: `Импорт выписки ${parsed.accountCode ?? ""} (${parsed.lines.length} операций)` });
  return imp.id;
}

// Создать поступление из строки-кредита и привязать к проекту.
export async function createIncomingFromLine(user: AuthenticatedUser, lineId: string, projectId: string) {
  if (!hasRole(user, "ACCOUNTANT", "CHIEF_ACCOUNTANT", "TREASURER_CFO")) throw new ImportError("Нет прав");
  const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId, import: { entityId: user.entityId } }, include: { incoming: true } });
  if (!line) throw new ImportError("Строка не найдена");
  if (line.incoming) throw new ImportError("Поступление уже создано");
  if (line.direction !== "CREDIT") throw new ImportError("Это не поступление");

  const project = await prisma.project.findFirst({ where: { id: projectId, entityId: user.entityId } });
  if (!project) throw new ImportError("Проект не найден");

  const incoming = await prisma.incoming.create({
    data: {
      entityId: user.entityId,
      amount: line.amount,
      receivedAt: line.occurredAt,
      counterpartyName: line.counterparty,
      projectId: project.id,
      responsibleUserId: project.ownerUserId,
      status: "UNALLOCATED",
      bankLineId: line.id,
    },
  });
  await prisma.bankStatementLine.update({ where: { id: line.id }, data: { matched: true } });
  await writeAudit({ entityId: user.entityId, userId: user.id, action: "INCOMING_FROM_STATEMENT", targetType: "Incoming", targetId: incoming.id, comment: `Поступление из выписки на проект ${project.name}` });
  return incoming.id;
}
