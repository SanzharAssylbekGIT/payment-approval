"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { createDeal, createClient, type DealState } from "@/lib/projects/actions";
import type { ServiceType } from "@prisma/client";

const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

export interface BloggerOpt {
  id: string;
  name: string;
  link: string | null;
  options: { name: string; kind: string; priceWithTax: string }[]; // цена — тенге строкой
}

interface ClientOpt {
  id: string;
  name: string;
}

interface Row {
  bloggerId: string; // id из базы | "" | "__custom__" (не из базы)
  name: string; // имя (для «не из базы»)
  optionName: string; // выбранная опция из прайса | "__custom__" | ""
  custom: string; // своя опция текстом
  fee: string; // гонорар (себес с налогом), тенге
  reserve: string; // продакшн-резерв по этой строке (блогер × опция), тенге
}

const emptyRow: Row = { bloggerId: "", name: "", optionName: "", custom: "", fee: "", reserve: "" };

function num(s: string): number {
  const n = Number(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function fmt(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ")} ₸`;
}

// Кнопка «Создать проект» + модальное окно. Окно монтируется заново при каждом
// открытии — форма всегда стартует чистой.
export function NewDealForm(props: {
  projectManagers: { id: string; fullName: string }[];
  clients: ClientOpt[];
  bloggers: BloggerOpt[];
  owners: { id: string; fullName: string }[]; // пусто → владелец = создающий
  service: ServiceType;
  nextNumber: number; // номер, который присвоит система (сквозной по компании)
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
      >
        + Создать проект
      </button>
      {open && <DealModal {...props} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DealModal({
  projectManagers,
  clients,
  bloggers,
  owners,
  service,
  nextNumber,
  onClose,
}: {
  projectManagers: { id: string; fullName: string }[];
  clients: ClientOpt[];
  bloggers: BloggerOpt[];
  owners: { id: string; fullName: string }[];
  service: ServiceType;
  nextNumber: number;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(createDeal, {} as DealState);
  const [deal, setDeal] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ...emptyRow }]);

  // Экран внутри окна: сама сделка или добавление нового клиента.
  // Форма сделки при переходе скрывается (не размонтируется) — данные не теряются.
  const [view, setView] = useState<"deal" | "newClient">("deal");

  // Клиент: только выбор из справочника (поиск), свободный текст не принимается.
  const [added, setAdded] = useState<ClientOpt[]>([]); // добавленные в этом окне
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);

  // Окно добавления клиента.
  const [newClientName, setNewClientName] = useState("");
  const [newClientError, setNewClientError] = useState<string | null>(null);
  const [savingClient, startSavingClient] = useTransition();

  useEffect(() => {
    if (state.ok) onClose(); // проект создан — список обновится ревалидацией
  }, [state.ok, onClose]);

  const allClients = useMemo(() => {
    const merged = [...clients, ...added.filter((a) => !clients.some((c) => c.id === a.id))];
    return merged.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [clients, added]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return allClients;
    return allClients.filter((c) => c.name.toLowerCase().includes(q));
  }, [allClients, clientQuery]);

  function selectClient(c: ClientOpt) {
    setClientId(c.id);
    setClientQuery(c.name);
    setListOpen(false);
  }

  function openNewClient() {
    setNewClientName(clientQuery.trim());
    setNewClientError(null);
    setListOpen(false);
    setView("newClient");
  }

  function saveNewClient() {
    const name = newClientName.trim();
    if (!name) {
      setNewClientError("Укажите название клиента");
      return;
    }
    startSavingClient(async () => {
      const res = await createClient(name);
      if (res.client) {
        setAdded((xs) => [...xs, res.client!]);
        selectClient(res.client);
        setView("deal");
      } else {
        setNewClientError(res.error ?? "Не удалось добавить клиента");
      }
    });
  }

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
    const reserves = rows.reduce((s, r) => s + num(r.reserve), 0);
    const cost = fees + reserves;
    return { vat, net, fees, reserves, cost, margin: net - cost };
  }, [deal, rows]);

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
          reserve: r.reserve || null,
          optionName: opt?.name ?? null,
          kind: opt?.kind ?? null,
          custom: r.custom || null,
          base: opt ? opt.priceWithTax : undefined,
          isCategory: false,
        };
      }),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {view === "deal" ? "Создать проект" : "Новый клиент"}
          </h2>
          <button type="button" onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-gray-600" title="Закрыть">
            ✕
          </button>
        </div>

        {/* Окно добавления клиента */}
        {view === "newClient" && (
          <div className="space-y-4 p-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">Название клиента *</label>
              <input
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="Яндекс Поиск"
                autoFocus
                className={inputCls}
              />
              <p className="mt-1 text-xs text-gray-400">Клиент попадёт в общий справочник и станет доступен всем.</p>
            </div>
            {newClientError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{newClientError}</p>}
            <div className="flex justify-between">
              <button type="button" onClick={() => setView("deal")} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                ← Назад к проекту
              </button>
              <button
                type="button"
                onClick={saveNewClient}
                disabled={savingClient}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {savingClient ? "Сохранение…" : "Сохранить клиента"}
              </button>
            </div>
          </div>
        )}

        {/* Форма сделки (скрыта, но не размонтирована, пока открыто окно клиента) */}
        <form action={formAction} className={view === "deal" ? "space-y-5 p-6" : "hidden"}>
          <input type="hidden" name="linesJson" value={linesJson} />
          <input type="hidden" name="serviceType" value={service} />
          <input type="hidden" name="clientId" value={clientId} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Номер проекта</label>
              <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                № {nextNumber}
              </div>
              <p className="mt-1 text-xs text-gray-400">Присваивается системой автоматически, сквозная нумерация по компании.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Название проекта *</label>
              <input name="name" required placeholder="Наурыз" className={inputCls} />
            </div>

            {/* Клиент: выпадающий список с поиском + «Добавить клиента» */}
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700">Клиент *</label>
              <input
                value={clientQuery}
                onChange={(e) => {
                  setClientQuery(e.target.value);
                  setClientId(""); // текст изменили — выбор сбрасывается
                  setListOpen(true);
                }}
                onFocus={() => setListOpen(true)}
                onBlur={() => setTimeout(() => setListOpen(false), 150)}
                placeholder="Поиск по списку клиентов…"
                autoComplete="off"
                className={inputCls}
              />
              {clientId === "" && clientQuery.trim() !== "" && !listOpen && (
                <p className="mt-1 text-xs text-amber-600">Выберите клиента из списка или добавьте нового.</p>
              )}
              {listOpen && (
                <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {filteredClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectClient(c);
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-indigo-50 ${c.id === clientId ? "bg-indigo-50 font-medium text-indigo-700" : "text-gray-700"}`}
                    >
                      {c.name}
                    </button>
                  ))}
                  {filteredClients.length === 0 && (
                    <p className="px-3 py-2 text-sm text-gray-400">Ничего не найдено</p>
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      openNewClient();
                    }}
                    className="block w-full border-t border-gray-100 px-3 py-2 text-left text-sm font-medium text-indigo-600 hover:bg-indigo-50"
                  >
                    + Добавить клиента{clientQuery.trim() ? ` «${clientQuery.trim()}»` : ""}
                  </button>
                </div>
              )}
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
              <label className="block text-sm font-medium text-gray-700">Запланированная дата завершения проекта *</label>
              <input name="completionDate" type="date" required className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Сумма сделки (с НДС), ₸ *</label>
            <input name="dealAmount" inputMode="decimal" required placeholder="1 000 000" value={deal} onChange={(e) => setDeal(e.target.value)} className={inputCls} />
          </div>

          {/* Таблица блогеров: одна строка = блогер × опция, у каждой свой резерв */}
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Выплаты блогерам * (одна строка = блогер × опция; продакшн-резерв — по каждой строке)
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
                      <input
                        inputMode="decimal"
                        placeholder="Гонорар (себес с налогом), ₸"
                        value={r.fee}
                        onChange={(e) => setRow(i, { fee: e.target.value })}
                        className={`${inputCls} mt-0 w-44`}
                      />
                      <input
                        inputMode="decimal"
                        placeholder="Продакшн-резерв, ₸"
                        value={r.reserve}
                        onChange={(e) => setRow(i, { reserve: e.target.value })}
                        className={`${inputCls} mt-0 w-40`}
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
              + Добавить блогера / опцию
            </button>
          </div>

          {/* Живой расчёт экономики */}
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-gray-500">НДС (12/112)</p><p className="font-medium">{fmt(totals.vat)}</p></div>
            <div><p className="text-xs text-gray-500">Без НДС</p><p className="font-medium">{fmt(totals.net)}</p></div>
            <div>
              <p className="text-xs text-gray-500">Себестоимость</p>
              <p className="font-medium">{fmt(totals.cost)}</p>
              {totals.reserves > 0 && <p className="text-xs text-gray-400">в т.ч. резерв {fmt(totals.reserves)}</p>}
            </div>
            <div>
              <p className="text-xs text-gray-500">Маржа</p>
              <p className={`font-medium ${totals.margin < 0 ? "text-red-600" : "text-green-700"}`}>{fmt(totals.margin)}</p>
            </div>
          </div>

          {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Отмена
            </button>
            <button type="submit" disabled={pending} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {pending ? "Создание…" : "Создать проект"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
