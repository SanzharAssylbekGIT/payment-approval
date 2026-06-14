"use client";

import { useActionState } from "react";
import { createIncomingForLine, type ImportState } from "@/lib/import/actions";

const initial: ImportState = {};

// Привязка строки-кредита к проекту → создание поступления.
export function IncomingFromLineForm({ lineId, projects }: { lineId: string; projects: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(createIncomingForLine, initial);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="lineId" value={lineId} />
      <select name="projectId" required defaultValue="" className="rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:border-indigo-500">
        <option value="">— проект —</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "…" : "Создать"}
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
