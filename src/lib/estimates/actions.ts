"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/rbac";
import { parseTengeToTiyn } from "@/lib/money";
import { EstimateError, saveEstimateVersion, type EstimateLineInput } from "./service";

export type EstimateState = { error?: string; ok?: boolean };

const schema = z.object({
  clientPriceGross: z.string().min(1, "Укажите цену клиенту"),
  reason: z.enum(["INITIAL", "WRONG_ESTIMATE", "PROJECT_REDUCED", "OTHER"]).default("OTHER"),
  comment: z.string().optional(),
});

// Сохранение версии сметы из формы проекта.
export async function saveEstimate(projectId: string, _prev: EstimateState, formData: FormData): Promise<EstimateState> {
  const user = await requireUser();

  const parsed = schema.safeParse({
    clientPriceGross: formData.get("clientPriceGross"),
    reason: formData.get("reason") || "OTHER",
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };

  let grossTiyn: bigint;
  try {
    grossTiyn = parseTengeToTiyn(parsed.data.clientPriceGross);
  } catch {
    return { error: "Некорректная сумма" };
  }

  // Строки: параллельные массивы lineTitle[] / lineAmount[] / lineReserve[] /
  // lineCategory[] ("1"|"0"). Резервы построчные — Σ уходит в депозит продакшна.
  const titles = formData.getAll("lineTitle").map(String);
  const amounts = formData.getAll("lineAmount").map(String);
  const reserves = formData.getAll("lineReserve").map(String);
  const categories = formData.getAll("lineCategory").map(String);
  const lines: EstimateLineInput[] = [];
  for (let i = 0; i < titles.length; i++) {
    if (!titles[i].trim() && !amounts[i]?.trim()) continue; // пустая строка формы
    let amountTiyn: bigint;
    try {
      amountTiyn = parseTengeToTiyn(amounts[i] ?? "");
    } catch {
      return { error: `Строка «${titles[i] || i + 1}»: некорректная сумма` };
    }
    let reserveTiyn = 0n;
    if (reserves[i]?.trim()) {
      try {
        reserveTiyn = parseTengeToTiyn(reserves[i]);
      } catch {
        return { error: `Строка «${titles[i] || i + 1}»: некорректный продакшн-резерв` };
      }
    }
    lines.push({ title: titles[i], amountTiyn, reserveTiyn, isCategory: categories[i] === "1" });
  }

  try {
    await saveEstimateVersion(user, projectId, {
      clientPriceGrossTiyn: grossTiyn,
      lines,
      reason: parsed.data.reason,
      comment: parsed.data.comment ?? null,
    });
  } catch (e) {
    if (e instanceof EstimateError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/accounting/projects");
  revalidatePath("/treasury");
  return { ok: true };
}
