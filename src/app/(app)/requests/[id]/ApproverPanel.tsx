"use client";

import { useState, useTransition } from "react";
import { approveStep, rejectStep, requestClarification } from "@/lib/requests/actions";

// Панель решения согласующего: одобрить / отклонить / запросить уточнение.
// Для отклонения и уточнения комментарий обязателен.
export function ApproverPanel({ id }: { id: string }) {
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const noComment = comment.trim().length === 0;

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">Заявка ждёт вашего решения</p>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        placeholder="Комментарий (обязателен для отклонения и уточнения)"
        className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
      />
      <div className="flex flex-wrap gap-2">
        <button
          disabled={pending}
          onClick={() => start(() => approveStep(id, comment))}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
        >
          Одобрить
        </button>
        <button
          disabled={pending || noComment}
          onClick={() => start(() => rejectStep(id, comment))}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Отклонить
        </button>
        <button
          disabled={pending || noComment}
          onClick={() => start(() => requestClarification(id, comment))}
          className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          Запросить уточнение
        </button>
      </div>
    </div>
  );
}
