"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/rbac";
import { addToRegister, removeFromRegister, markPaid, TreasuryError } from "./service";

function revalidateTreasury(id?: string) {
  revalidatePath("/treasury");
  revalidatePath("/payments");
  revalidatePath("/accounting");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/requests/${id}`);
}

export type TreasuryActionState = { error?: string; ok?: boolean };

export async function addToRegisterAction(id: string): Promise<void> {
  const user = await requireUser();
  try {
    await addToRegister(user, id);
  } catch (e) {
    if (!(e instanceof TreasuryError)) throw e;
  }
  revalidateTreasury(id);
}

export async function removeFromRegisterAction(id: string): Promise<void> {
  const user = await requireUser();
  try {
    await removeFromRegister(user, id);
  } catch (e) {
    if (!(e instanceof TreasuryError)) throw e;
  }
  revalidateTreasury(id);
}

// Отметка «оплачено» бухгалтером. Принимает дату списания (по факту).
export async function markPaidAction(_prev: TreasuryActionState, formData: FormData): Promise<TreasuryActionState> {
  const user = await requireUser();
  const id = String(formData.get("requestId") ?? "");
  const dateStr = String(formData.get("paidDate") ?? "");
  const occurredAt = dateStr ? new Date(dateStr) : new Date();
  try {
    await markPaid(user, id, occurredAt);
  } catch (e) {
    if (e instanceof TreasuryError) return { error: e.message };
    throw e;
  }
  revalidateTreasury(id);
  return { ok: true };
}
