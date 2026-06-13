"use client";

import { useActionState, useMemo, useState } from "react";
import { createRequest, type CreateState } from "@/lib/requests/actions";
import { PRIORITY_LABELS } from "@/lib/requests/status";
import type { Priority } from "@prisma/client";

interface ExpenseTypeOpt {
  id: string;
  name: string;
  isProjectCost: boolean;
  requiresEstimate: boolean;
  defaultPriority: Priority;
}
interface ProjectOpt {
  id: string;
  name: string;
  clientName: string | null;
  serviceType: string;
  recipients: { id: string; name: string }[];
  estimateLines: { id: string; title: string; plannedAmount: string; recipientId: string | null }[];
}

const initialState: CreateState = {};
const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

export function RequestForm({
  expenseTypes,
  projects,
}: {
  expenseTypes: ExpenseTypeOpt[];
  projects: ProjectOpt[];
}) {
  const [state, formAction, pending] = useActionState(createRequest, initialState);
  const [expenseTypeId, setExpenseTypeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<Priority>("FLEXIBLE");

  const selectedType = expenseTypes.find((e) => e.id === expenseTypeId);
  const isProjectCost = selectedType?.isProjectCost ?? false;
  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
      {/* Вид расхода */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Вид расхода *</label>
        <select
          name="expenseTypeId"
          required
          value={expenseTypeId}
          onChange={(e) => {
            setExpenseTypeId(e.target.value);
            const t = expenseTypes.find((x) => x.id === e.target.value);
            if (t) setPriority(t.defaultPriority);
            setProjectId("");
          }}
          className={inputCls}
        >
          <option value="">— выберите —</option>
          {expenseTypes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </div>

      {/* Проектные поля */}
      {isProjectCost && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700">Проект *</label>
            <select
              name="projectId"
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={inputCls}
            >
              <option value="">— выберите проект —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName ? `${p.clientName} · ${p.name}` : p.name}
                </option>
              ))}
            </select>
            {projects.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">Нет доступных проектов — обратитесь к ответственному за учёт.</p>
            )}
          </div>

          {selectedProject && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Получатель</label>
                <select name="recipientId" className={inputCls} defaultValue="">
                  <option value="">— не указан —</option>
                  {selectedProject.recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Строка сметы (план)</label>
                <select name="estimateLineId" className={inputCls} defaultValue="">
                  <option value="">— не привязывать —</option>
                  {selectedProject.estimateLines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </>
      )}

      {/* Сумма + приоритет */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Сумма, ₸ *</label>
          <input name="amount" inputMode="decimal" placeholder="350 000" required className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Приоритет</label>
          <select
            name="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className={inputCls}
          >
            {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Назначение */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Назначение платежа *</label>
        <input name="purpose" required placeholder="За что платим" className={inputCls} />
      </div>

      {/* Дата + файл */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Желаемая дата оплаты</label>
          <input name="desiredPayDate" type="date" className={inputCls} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Счёт / договор (файл)</label>
          <input name="file" type="file" className="mt-1 w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm" />
        </div>
      </div>

      {/* Комментарий */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Комментарий</label>
        <textarea name="comment" rows={2} className={inputCls} />
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Сохранение…" : "Создать черновик"}
        </button>
      </div>
    </form>
  );
}
