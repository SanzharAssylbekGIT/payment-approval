"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createDeal, type DealState } from "@/lib/projects/actions";
import { SERVICE_LABELS } from "@/lib/accounting/labels";
import type { ServiceType } from "@prisma/client";

const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

export interface BloggerOpt {
  id: string;
  name: string;
  link: string | null;
  options: { name: string; kind: string; priceWithTax: string }[]; // цена — тенге строкой
}

interface Row {
  bloggerId: string; // id из базы | "" | "__custom__" (не из базы)
  name: string; // имя (для «не из базы»)
  optionName: string; // выбранная опция из прайса | "__custom__" | ""
  custom: string; // своя опция текстом
  fee: string; // гонорар (себес с налогом), тенге
}

const SERVICE_KEYS = Object.keys(SERVICE_LABELS) as ServiceType[];
const emptyRow: Row = { bloggerId: "", name: "", optionName: "", custom: "", fee: "" };

function num(s: string): number {
  const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")} ₸`;
}

// Форма сделки (DECISIONS §14): пара продажник+проджект, сроки, экономика,
// блогеры из базы цен — опция выбирается из прайса блогера (дропдаун), цена
// подставляется (себес с налогом), скидка = прайс − заполненный гонорар.
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

  function bloggerOf(row: Row) {
    return bloggers.find((b) => b.id === row.bloggerId) ?? null;
  }
  function optionOf(row: Row) {
    const b = bloggerOf(row);
    if (!b || row.optionName === "__custom__") return null;
    return b.options.find((o) => o.name === row.optionName) ?? null;
  }

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

  const linesJson = JSON.stringify(
    rows
      .filter((r) => r.name.trim() || r.fee.trim() || r.bloggerId)
      .map((r) => {
        const b = bloggerOf(r);
        const opt = optionOf(r);
        return {
          bloggerId: b?.id ?? null,
          name: b?.name ?? r.name,
          fee: r.fee,
          optionName: opt?.name ?? null,
          kind: opt?.kind ?? null,
          custom: r.custom || null,
          base: opt ? opt.priceWithTax : undefined,
          isCategory: false,
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
            {isInfluence ? "Выплаты блогерам * (одна строка = блогер × опция)" : "Строки себестоимости *"}
          </label>
          <div className="mt-2 space-y-3">
            {rows.map((r, i) => {
              const b = bloggerOf(r);
              const opt = optionOf(r);
              const base = opt ? num(opt.priceWithTax) : 0;
              const fee = num(r.fee);
              const discount = base > 0 && fee > 0 ? base - fee : 0;
              return (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {isInfluence ? (
                      <>
                        <select
                          value={r.bloggerId}
                          onChange={(e) => {
                            const v = e.target.value;
                            const nb = bloggers.find((x) => x.id === v);
                            setRow(i, { bloggerId: v, name: nb?.name ?? "", optionName: "", custom: "", fee: "" });
                          }}
                          className={`${inputCls} mt-0 w-56`}
                        >
                          <option value="">— блогер из базы —</option>
                          {bloggers.map((x) => (
                            <option key={x.id} value={x.id}>{x.name}</option>
                          ))}
                          <option value="__custom__">Другой (не из базы)</option>
                        </select>

                        {r.bloggerId === "__custom__" && (
                          <input
                            placeholder="Имя блогера"
                            value={r.name}
                            onChange={(e) => setRow(i, { name: e.target.value })}
                            className={`${inputCls} mt-0 flex-1`}
                          />
                        )}

                        {/* Опция из прайса блогера (дропдаун) */}
                        {b && (
                          <select
                            value={r.optionName}
                            onChange={(e) => {
                              const v = e.target.value;
                              const o = b.options.find((x) => x.name === v);
                              setRow(i, { optionName: v, fee: o ? o.priceWithTax : r.fee, custom: "" });
                            }}
                            className={`${inputCls} mt-0 min-w-64 flex-1`}
                          >
                            <option value="">— опция из прайса —</option>
                            {b.options.map((o) => (
                              <option key={o.name} value={o.name}>
                                {o.name} — {fmt(num(o.priceWithTax))}
                              </option>
                            ))}
                            <option value="__custom__">Своя опция (вручную)</option>
                          </select>
                        )}
                        {(r.bloggerId === "__custom__" || r.optionName === "__custom__") && (
                          <input
                            placeholder="Что делает (опция)"
                            value={r.custom}
                            onChange={(e) => setRow(i, { custom: e.target.value })}
                            className={`${inputCls} mt-0 w-52`}
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
                      placeholder="Гонорар (себес с налогом), ₸"
                      value={r.fee}
                      onChange={(e) => setRow(i, { fee: e.target.value })}
                      className={`${inputCls} mt-0 w-44`}
                    />
                    {rows.length > 1 && (
                      <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" title="Убрать">✕</button>
                    )}
                  </div>

                  {(base > 0 || b?.link) && (
                    <p className="mt-2 flex flex-wrap gap-3 text-xs">
                      {base > 0 && <span className="text-gray-500">Прайс: {fmt(base)}</span>}
                      {discount > 0 && <span className="font-medium text-green-700">скидка {fmt(discount)}</span>}
                      {discount < 0 && <span className="font-medium text-red-600">выше прайса на {fmt(-discount)}</span>}
                      {b?.link && (
                        <a href={b.link} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">аккаунт ↗</a>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => setRows((rs) => [...rs, { ...emptyRow }])} className="mt-2 text-sm text-indigo-600 hover:underline">
            + Добавить {isInfluence ? "блогера / опцию" : "строку"}
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
