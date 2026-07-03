"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/rbac";
import { parseTengeToTiyn } from "@/lib/money";
import { EstimateError, saveEstimateVersion, type EstimateLineInput } from "./service";

export type EstimateState = { error?: string; ok?: boolean };

const schema = z.object({
  clientPriceGross: z.string().min(1, "Укажите цену клиенту"),
  deposit: z.string().optional(),
  reason: z.enum(["INITIAL", "WRONG_ESTIMATE", "PROJECT_REDUCED", "OTHER"]).default("OTHER"),
  comment: z.string().optional(),
});

// Сохранение версии сметы из формы проекта.
export async function saveEstimate(projectId: string, _prev: EstimateState, formData: FormData): Promise<EstimateState> {
  const user = await requireUser();

  const parsed = schema.safeParse({
    clientPriceGross: formData.get("clientPriceGross"),
    deposit: formData.get("deposit") || undefined,
    reason: formData.get("reason") || "OTHER",
    comment: formData.get("comment") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };

  let grossTiyn: bigint;
  let depositTiyn = 0n;
  try {
    grossTiyn = parseTengeToTiyn(parsed.data.clientPriceGross);
    if (parsed.data.deposit) depositTiyn = parseTengeToTiyn(parsed.data.deposit);
  } catch {
    return { error: "Некорректная сумма" };
  }

  // Строки: параллельные массивы lineTitle[] / lineAmount[] / lineCategory[] ("1"|"0").
  const titles = formData.getAll("lineTitle").map(String);
  const amounts = formData.getAll("lineAmount").map(String);
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
    lines.push({ title: titles[i], amountTiyn, isCategory: categories[i] === "1" });
  }

  try {
    await saveEstimateVersion(user, projectId, {
      clientPriceGrossTiyn: grossTiyn,
      depositTiyn,
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
