"use client";

import { useActionState } from "react";
import { markPaidAction, type TreasuryActionState } from "@/lib/treasury/actions";

const initial: TreasuryActionState = {};

// Форма отметки «оплачено» по факту списания (бухгалтер). Дата = дата списания.
export function MarkPaidForm({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState(markPaidAction, initial);

  return (
    <form action={formAction} className="flex items-center justify-end gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input
        type="date"
        name="paidDate"
        required
        className="rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:border-indigo-500"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {pending ? "…" : "Оплачено"}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
