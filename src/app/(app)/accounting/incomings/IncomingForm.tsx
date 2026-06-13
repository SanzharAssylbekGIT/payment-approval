"use client";

import { useActionState } from "react";
import { createIncoming, type IncomingState } from "@/lib/accounting/actions";

const initial: IncomingState = {};
const inputCls = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

export function IncomingForm({ projects }: { projects: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createIncoming, initial);

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm font-medium text-gray-700">Зарегистрировать поступление</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-gray-500">Сумма, ₸</label>
          <input name="amount" inputMode="decimal" placeholder="1 000 000" required className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Дата зачисления</label>
          <input name="receivedAt" type="date" required className={inputCls} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500">Проект</label>
        <select name="projectId" required className={inputCls} defaultValue="">
          <option value="">— выберите проект —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500">Плательщик (необязательно)</label>
        <input name="counterpartyName" className={inputCls} />
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Поступление зарегистрировано.</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Сохранение…" : "Зарегистрировать"}
      </button>
    </form>
  );
}
