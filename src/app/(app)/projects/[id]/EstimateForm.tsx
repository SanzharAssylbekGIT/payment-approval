"use client";

import { useActionState, useMemo, useState } from "react";
import type { EstimateState } from "@/lib/estimates/actions";

const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

const REASON_LABELS: Record<string, string> = {
  WRONG_ESTIMATE: "Исправление — была не та смета",
  PROJECT_REDUCED: "Проект сократили",
  OTHER: "Другое",
};

interface LineDraft {
  title: string;
  amount: string;
  isCategory: boolean;
}

function parseTenge(s: string): number {
  const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")} ₸`;
}

// Форма сметы: v1 или ревизия (versionNo > 1 → причина обязательна).
// Расчёт: НДС = 12/112 от цены; себестоимость = сумма строк; маржа = без НДС − себест.
export function EstimateForm({
  action,
  versionNo,
  isInfluence,
  initial,
}: {
  action: (prev: EstimateState, formData: FormData) => Promise<EstimateState>;
  versionNo: number; // номер СОЗДАВАЕМОЙ версии (1 = первичная)
  isInfluence: boolean;
  initial?: { clientPriceGross: string; deposit: string; lines: LineDraft[] };
}) {
  const [state, formAction, pending] = useActionState(action, {} as EstimateState);
  const [gross, setGross] = useState(initial?.clientPriceGross ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    initial?.lines?.length ? initial.lines : [{ title: "", amount: "", isCategory: false }],
  );

  const totals = useMemo(() => {
    const g = parseTenge(gross);
    const vat = (g * 12) / 112;
    const net = g - vat;
    const cost = lines.reduce((s, l) => s + parseTenge(l.amount), 0);
    return { vat, net, cost, margin: net - cost };
  }, [gross, lines]);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Цена клиенту (с НДС), ₸ *</label>
          <input
            name="clientPriceGross"
            inputMode="decimal"
            required
            placeholder="1 000 000"
            value={gross}
            onChange={(e) => setGross(e.target.value)}
            className={inputCls}
          />
        </div>
        {isInfluence && (
          <div>
            <label className="block text-sm font-medium text-gray-700">Продакшн-бюджет (в депозит), ₸</label>
            <input name="deposit" inputMode="decimal" placeholder="0" defaultValue={initial?.deposit ?? ""} className={inputCls} />
            <p className="mt-1 text-xs text-gray-400">Часть себестоимости, уходящая в депозит продакшна.</p>
          </div>
        )}
      </div>

      {/* Строки себестоимости */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Себестоимость: получатели / категории *</label>
        <div className="mt-2 space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                name="lineTitle"
                placeholder={l.isCategory ? "Категория (например, Продакшн)" : "Имя получателя (блогер/подрядчик)"}
                value={l.title}
                onChange={(e) => setLine(i, { title: e.target.value })}
                className={`${inputCls} mt-0 flex-1`}
              />
              <input
                name="lineAmount"
                inputMode="decimal"
                placeholder="Сумма, ₸"
                value={l.amount}
                onChange={(e) => setLine(i, { amount: e.target.value })}
                className={`${inputCls} mt-0 w-36`}
              />
              <input type="hidden" name="lineCategory" value={l.isCategory ? "1" : "0"} />
              <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={l.isCategory}
                  onChange={(e) => setLine(i, { isCategory: e.target.checked })}
                  className="rounded border-gray-300"
                />
                категория
              </label>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-600"
                  title="Убрать строку"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { title: "", amount: "", isCategory: false }])}
          className="mt-2 text-sm text-indigo-600 hover:underline"
        >
          + Добавить строку
        </button>
      </div>

      {/* Живой расчёт */}
      <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-4">
        <div><p className="text-xs text-gray-500">НДС (12/112)</p><p className="font-medium">{fmt(totals.vat)}</p></div>
        <div><p className="text-xs text-gray-500">Без НДС</p><p className="font-medium">{fmt(totals.net)}</p></div>
        <div><p className="text-xs text-gray-500">Себестоимость</p><p className="font-medium">{fmt(totals.cost)}</p></div>
        <div>
          <p className="text-xs text-gray-500">Маржа</p>
          <p className={`font-medium ${totals.margin < 0 ? "text-red-600" : "text-green-700"}`}>{fmt(totals.margin)}</p>
        </div>
      </div>
      {totals.margin < 0 && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Себестоимость превышает цену без НДС — такую смету сохранить нельзя.
        </p>
      )}

      {/* Причина ревизии (для v2+) */}
      {versionNo > 1 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Причина изменения *</label>
            <select name="reason" required defaultValue="" className={inputCls}>
              <option value="">— выберите —</option>
              {Object.entries(REASON_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Комментарий</label>
            <input name="comment" placeholder="Что изменилось" className={inputCls} />
          </div>
        </div>
      )}

      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Смета сохранена.</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? "Сохранение…" : versionNo === 1 ? "Сохранить смету" : `Сохранить версию ${versionNo}`}
        </button>
      </div>
      {versionNo > 1 && (
        <p className="text-xs text-amber-600">
          Новая версия автоматически пере-разнесёт уже полученные поступления по новой смете.
        </p>
      )}
    </form>
  );
}
