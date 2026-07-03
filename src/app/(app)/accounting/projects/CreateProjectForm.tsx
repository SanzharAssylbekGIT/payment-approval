"use client";

import { useActionState, useEffect, useRef } from "react";
import { createProject, type ProjectState } from "@/lib/accounting/actions";
import { SERVICE_LABELS } from "@/lib/accounting/labels";
import type { ServiceType } from "@prisma/client";

const initialState: ProjectState = {};
const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
const SERVICE_KEYS = Object.keys(SERVICE_LABELS) as ServiceType[];

export function CreateProjectForm({
  clients,
  users,
}: {
  clients: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
}) {
  const [state, formAction, pending] = useActionState(createProject, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <details className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-indigo-600">+ Создать проект</summary>
      <form ref={formRef} action={formAction} className="space-y-4 border-t border-gray-100 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Название проекта *</label>
            <input name="name" required placeholder="Наурыз" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Клиент *</label>
            <input name="clientName" required list="clients-list" placeholder="Яндекс Поиск" className={inputCls} />
            <datalist id="clients-list">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Услуга *</label>
            <select name="serviceType" required defaultValue="" className={inputCls}>
              <option value="">— выберите —</option>
              {SERVICE_KEYS.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Ответственный</label>
            <select name="ownerUserId" defaultValue="" className={inputCls}>
              <option value="">— не назначен —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">От департамента ответственного зависит, кто увидит проект в форме заявки.</p>
          </div>
        </div>

        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Проект создан.</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Создание…" : "Создать проект"}
          </button>
        </div>
      </form>
    </details>
  );
}
