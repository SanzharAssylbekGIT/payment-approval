"use client";

import { useActionState } from "react";
import type { RoleName } from "@prisma/client";
import { createUser, type AdminState } from "@/lib/admin/actions";
import { ROLE_LABELS } from "@/lib/auth/permissions";

const initial: AdminState = {};
const inputCls = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
const ROLES = Object.keys(ROLE_LABELS) as RoleName[];

export function CreateUserForm({ departments }: { departments: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createUser, initial);

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-sm font-medium text-gray-700">Новый пользователь</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-gray-500">ФИО</label>
          <input name="fullName" required className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">E-mail</label>
          <input name="email" type="email" required className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Должность</label>
          <input name="position" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Подразделение</label>
          <select name="departmentId" className={inputCls} defaultValue="">
            <option value="">— не выбрано —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500">Пароль</label>
          <input name="password" type="text" required minLength={6} className={inputCls} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs text-gray-500">Роли</p>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-700">
              <input type="checkbox" name="roles" value={r} /> {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
      </div>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Пользователь создан.</p>}
      <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
        {pending ? "Создание…" : "Создать пользователя"}
      </button>
    </form>
  );
}
