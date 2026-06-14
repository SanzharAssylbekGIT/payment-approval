"use client";

import { useActionState } from "react";
import { uploadStatement, type ImportState } from "@/lib/import/actions";

const initial: ImportState = {};

export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadStatement, initial);
  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm font-medium text-gray-700">Загрузить выписку Kaspi (.xlsx)</p>
      <input
        name="file"
        type="file"
        accept=".xlsx"
        required
        className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
      />
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Разбор…" : "Загрузить и разобрать"}
      </button>
    </form>
  );
}
