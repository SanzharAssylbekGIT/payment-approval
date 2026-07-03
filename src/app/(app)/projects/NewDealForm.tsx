"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createDeal, type DealState } from "@/lib/projects/actions";
import { DELIVERABLE_LABELS, DEAL_DELIVERABLES } from "@/lib/requests/status";
import { SERVICE_LABELS } from "@/lib/accounting/labels";
import type { BloggerDeliverable, ServiceType } from "@prisma/client";

const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

export interface BloggerOpt {
  id: string;
  name: string;
  prices: Partial<Record<BloggerDeliverable, string>>; // тенге строкой
}

interface Row {
  bloggerId: string; // id из базы | "" (не выбран) | "__custom__" (не из базы)
  name: string;
  fee: string;
  deliverables: BloggerDeliverable[];
  custom: string;
}

const SERVICE_KEYS = Object.keys(SERVICE_LABELS) as ServiceType[];
const emptyRow: Row = { bloggerId: "", name: "", fee: "", deliverables: [], custom: "" };

function num(s: string): number {
  const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")} ₸`;
}

// Прайс строки = Σ цен блогера по выбранным форматам (если блогер из базы).
function rowBase(row: Row, bloggers: BloggerOpt[]): number {
  const b = bloggers.find((x) => x.id === row.bloggerId);
  if (!b) return 0;
  return row.deliverables.reduce((s, d) => s + num(b.prices[d] ?? "0"), 0);
}

// Форма сделки (DECISIONS §14): пара продажник+проджект, сроки, экономика,
// таблица блогеров с базой цен и скидками. Себес = резерв + гонорары.
export function NewDealForm({
  projectManagers,
  clients,
  bloggers,
  owners,
  defaultService,
}: {
  projectManagers: { id: string; fullName: string }[];
  clients: { id: string; name: string }[];
  bloggers: BloggerOpt[];
  owners: { id: string; fullName: string }[]; // пусто → владелец = создающий
  defaultService?: ServiceType;
}) {
  const [state, formAction, pending] = useActionState(createDeal, {} as DealState);
  const formRef = useRef<HTMLFormElement>(null);
  const [service, setService] = useState<ServiceType>(defaultService ?? "INFLUENCE");
  const [deal, setDeal] = useState("");
  const [reserve, setReserve] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);

  const isInfluence = service === "INFLUENCE";

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setDeal(""); setReserve(""); setRows([{ ...emptyRow }]);
    }
  }, [state.ok]);

  const totals = useMemo(() => {
    const g = num(deal);
    const vat = (g * 12) / 112;
    const net = g - vat;
    const fees = rows.reduce((s, r) => s + num(r.fee), 0);
    const cost = fees + num(reserve);
    return { vat, net, cost, margin: net - cost };
  }, [deal, reserve, rows]);

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  // Строки для сервера: имя из базы или ручное, прайс на момент сделки.
  const linesJson = JSON.stringify(
    rows
      .filter((r) => r.name.trim() || r.fee.trim() || r.bloggerId)
      .map((r) => {
        const fromBase = bloggers.find((b) => b.id === r.bloggerId);
        const base = rowBase(r, bloggers);
        return {
          bloggerId: fromBase?.id ?? null,
          name: fromBase?.name ?? r.name,
          fee: r.fee,
          deliverables: r.deliverables,
          custom: r.custom,
          base: base > 0 ? String(base) : undefined,
          isCategory: false, // резерв добавляется категорией на сервере
        };
      }),
  );

  return (
    <details className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-indigo-600">+ Занести проект (сделку)</summary>
      <form ref={formRef} action={formAction} className="space-y-5 border-t border-gray-100 p-5">
        <input type="hidden" name="linesJson" value={linesJson} />

        {/* Проект и пара менеджеров */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Название проекта *</label>
            <input name="name" required placeholder="Наурыз" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Клиент *</label>
            <input name="clientName" required list="deal-clients" placeholder="Яндекс Поиск" className={inputCls} />
            <datalist id="deal-clients">
              {clients.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Услуга *</label>
            <select name="serviceType" required value={service} onChange={(e) => setService(e.target.value as ServiceType)} className={inputCls}>
              {SERVICE_KEYS.map((s) => (
                <option key={s} value={s}>{SERVICE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Проджект-менеджер *</label>
            <select name="projectManagerId" required defaultValue="" className={inputCls}>
              <option value="">— прикрепите проджекта —</option>
              {projectManagers.map((p) => (
                <option key={p.id} value={p.id}>{p.fullName}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">Менеджеры работают парами: продажник + проджект.</p>
          </div>
          {owners.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Продажник (владелец)</label>
              <select name="ownerUserId" defaultValue="" className={inputCls}>
                <option value="">— я —</option>
                {owners.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Сроки (дата регистрации фиксируется автоматически) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Дата реализации *</label>
            <input name="realizationDate" type="date" required className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Дата завершения проекта *</label>
            <input name="completionDate" type="date" required className={inputCls} />
          </div>
        </div>

        {/* Экономика сделки */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Сумма сделки (с НДС), ₸ *</label>
            <input name="dealAmount" inputMode="decimal" required placeholder="1 000 000" value={deal} onChange={(e) => setDeal(e.target.value)} className={inputCls} />
          </div>
          {isInfluence && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Продакшн-резерв, ₸</label>
              <input name="productionReserve" inputMode="decimal" placeholder="0" value={reserve} onChange={(e) => setReserve(e.target.value)} className={inputCls} />
              <p className="mt-1 text-xs text-gray-400">Часть себестоимости на продакшн (войдёт в смету отдельной строкой).</p>
            </div>
          )}
        </div>

        {/* Таблица блогеров / строк себестоимости */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {isInfluence ? "Выплаты блогерам *" : "Строки себестоимости *"}
          </label>
          <div className="mt-2 space-y-3">
            {rows.map((r, i) => {
              const fromBase = bloggers.find((b) => b.id === r.bloggerId);
              const base = rowBase(r, bloggers);
              const fee = num(r.fee);
              const discount = base > 0 && fee > 0 ? base - fee : 0;
              return (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2">
                    {isInfluence ? (
                      <>
                        <select
                          value={r.bloggerId}
                          onChange={(e) => {
                            const v = e.target.value;
                            const b = bloggers.find((x) => x.id === v);
                            setRow(i, { bloggerId: v, name: b?.name ?? r.name });
                          }}
                          className={`${inputCls} mt-0 w-56`}
                        >
                          <option value="">— блогер из базы —</option>
                          {bloggers.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                          <option value="__custom__">Другой (не из базы)</option>
                        </select>
                        {(r.bloggerId === "__custom__" || (!fromBase && r.bloggerId !== "")) && (
                          <input
                            placeholder="Имя блогера"
                            value={r.name}
                            onChange={(e) => setRow(i, { name: e.target.value })}
                            className={`${inputCls} mt-0 flex-1`}
                          />
                        )}
                      </>
                    ) : (
                      <input
                        placeholder="Получатель или категория"
                        value={r.name}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                        className={`${inputCls} mt-0 flex-1`}
                      />
                    )}
                    <input
                      inputMode="decimal"
                      placeholder="Гонорар, ₸"
                      value={r.fee}
                      onChange={(e) => setRow(i, { fee: e.target.value })}
                      className={`${inputCls} mt-0 w-36`}
                    />
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" title="Убрать">✕</button>
                    )}
                  </div>

                  {isInfluence && (
                    <>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {DEAL_DELIVERABLES.map((d) => (
                          <label key={d} className="flex items-center gap-1.5 text-xs text-gray-600">
                            <input
                              type="checkbox"
                              checked={r.deliverables.includes(d)}
                              onChange={(e) =>
                                setRow(i, {
                                  deliverables: e.target.checked
                                    ? [...r.deliverables, d]
                                    : r.deliverables.filter((x) => x !== d),
                                })
                              }
                              className="rounded border-gray-300"
                            />
                            {DELIVERABLE_LABELS[d]}
                          </label>
                        ))}
                        {r.deliverables.includes("OTHER") && (
                          <input
                            placeholder="что именно"
                            value={r.custom}
                            onChange={(e) => setRow(i, { custom: e.target.value })}
                            className="rounded border border-gray-300 px-2 py-0.5 text-xs"
                          />
                        )}
                      </div>
                      {base > 0 && (
                        <p className="mt-2 text-xs">
                          <span className="text-gray-500">Прайс по базе: {fmt(base)}</span>
                          {discount > 0 && <span className="ml-2 font-medium text-green-700">скидка {fmt(discount)}</span>}
                          {discount < 0 && <span className="ml-2 font-medium text-red-600">выше прайса на {fmt(-discount)}</span>}
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => setRows((rs) => [...rs, { ...emptyRow }])} className="mt-2 text-sm text-indigo-600 hover:underline">
            + Добавить {isInfluence ? "блогера" : "строку"}
          </button>
        </div>

        {/* Живой расчёт экономики */}
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-gray-500">НДС (12/112)</p><p className="font-medium">{fmt(totals.vat)}</p></div>
          <div><p className="text-xs text-gray-500">Без НДС</p><p className="font-medium">{fmt(totals.net)}</p></div>
          <div><p className="text-xs text-gray-500">Себестоимость</p><p className="font-medium">{fmt(totals.cost)}</p></div>
          <div>
            <p className="text-xs text-gray-500">Маржа</p>
            <p className={`font-medium ${totals.margin < 0 ? "text-red-600" : "text-green-700"}`}>{fmt(totals.margin)}</p>
          </div>
        </div>

        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">Проект создан вместе со сметой.</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {pending ? "Создание…" : "Занести проект"}
          </button>
        </div>
      </form>
    </details>
  );
}
