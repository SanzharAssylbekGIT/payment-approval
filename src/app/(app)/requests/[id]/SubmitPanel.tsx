"use client";

import { useActionState } from "react";
import { submitRequestWithState, type CreateState } from "@/lib/requests/actions";

const initialState: CreateState = {};

// Кнопка «Отправить на согласование» с показом ошибки сервиса (например,
// «услуга оказана — прикрепите акт»). Раньше ошибка глоталась молча.
export function SubmitPanel({ id }: { id: string }) {
  const [state, formAction, pending] = useActionState(submitRequestWithState.bind(null, id), initialState);

  return (
    <div>
      <form action={formAction}>
        <button
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Отправка…" : "Отправить на согласование"}
        </button>
      </form>
      {state.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
    </div>
  );
}
