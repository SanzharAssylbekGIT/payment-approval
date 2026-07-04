"use client";

import { useActionState, useEffect, useMemo, useState, useTransition, type ChangeEvent } from "react";
import { createDeal, createClient, parseEstimateExcel, type DealState } from "@/lib/projects/actions";
import { COMPANY_FORMS, KZ_BANKS, kbeDescription, type CompanyFormValue } from "@/lib/clients/constants";
import { projectCode } from "@/lib/projects/code";
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
  name: string; // имя (для «не из базы») / статья сметы (продакшн)
  optionName: string; // выбранная опция из прайса | "__custom__" | ""
  custom: string; // своя опция текстом
  fee: string; // гонорар / сумма строки (себес с налогом), тенге
  reserve: string; // продакшн-резерв по этой строке (блогер × опция), тенге
  // Продакшн-смета из Excel: раздел и детали строки (кол-во × смены × цена).
  section: string;
  qty: string;
  days: string;
  rate: string;
}

const emptyRow: Row = { bloggerId: "", name: "", optionName: "", custom: "", fee: "", reserve: "", section: "", qty: "", days: "", rate: "" };

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
  const isInfluence = service === "INFLUENCE";

  // Продакшн: смета загружается из Excel (.xlsx) и правится в окне.
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedFrom, setParsedFrom] = useState<string | null>(null); // имя загруженного файла
  const [parsing, startParsing] = useTransition();

  function onEstimateFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // чтобы можно было выбрать тот же файл повторно
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    setParseError(null);
    startParsing(async () => {
      const res = await parseEstimateExcel(fd);
      if (res.rows) {
        setRows(
          res.rows.map((r) => ({
            ...emptyRow,
            name: r.name,
            fee: r.amount,
            section: r.section ?? "",
            qty: r.qty ?? "",
            days: r.days ?? "",
            rate: r.rate ?? "",
          })),
        );
        setParsedFrom(f.name);
      } else {
        setParseError(res.error ?? "Не удалось прочитать файл");
      }
    });
  }

  // Продакшн-строка: правка кол-ва/смен/цены пересчитывает сумму строки.
  function setProdRow(i: number, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        if ("qty" in patch || "days" in patch || "rate" in patch) {
          const q = num(next.qty), d = num(next.days), rt = num(next.rate);
          if (q > 0 && d > 0 && rt > 0) next.fee = String(Math.round(q * d * rt * 100) / 100);
        }
        return next;
      }),
    );
  }

  // Экран внутри окна: сама сделка или добавление нового клиента.
  // Форма сделки при переходе скрывается (не размонтируется) — данные не теряются.
  const [view, setView] = useState<"deal" | "newClient">("deal");

  // Клиент: только выбор из справочника (поиск), свободный текст не принимается.
  const [added, setAdded] = useState<ClientOpt[]>([]); // добавленные в этом окне
  const [clientId, setClientId] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);

  // Окно добавления клиента: карточка с реквизитами (КБЕ считает система).
  const emptyClient = {
    name: "",
    legalName: "",
    form: "TOO" as CompanyFormValue,
    foreign: "local" as "local" | "foreign",
    bin: "",
    account: "",
    bank: "",
    bankOther: "",
  };
  const [nc, setNc] = useState(emptyClient);
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
    setNc({ ...emptyClient, name: clientQuery.trim() });
    setNewClientError(null);
    setListOpen(false);
    setView("newClient");
  }

  function saveNewClient() {
    if (!nc.name.trim()) {
      setNewClientError("Укажите название клиента");
      return;
    }
    // Лимиты по законодательству: БИН — ровно 12 цифр; счёт РК — IBAN 20 знаков.
    if (nc.bin && nc.bin.length !== 12) {
      setNewClientError("БИН должен состоять ровно из 12 цифр");
      return;
    }
    if (nc.account.startsWith("KZ") && nc.account.length !== 20) {
      setNewClientError("Казахстанский счёт (IBAN) — ровно 20 знаков: KZ и ещё 18");
      return;
    }
    startSavingClient(async () => {
      const res = await createClient({
        name: nc.name,
        legalName: nc.legalName,
        companyForm: nc.form,
        isForeign: nc.foreign === "foreign",
        bin: nc.bin,
        bankAccount: nc.account,
        bankName: nc.bank === "__other__" ? nc.bankOther : nc.bank,
      });
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
    const vat = (g * 16) / 116;
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

        {/* Окно добавления клиента: карточка с реквизитами */}
        {view === "newClient" && (
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Название клиента *</label>
                <input
                  value={nc.name}
                  onChange={(e) => setNc((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Яндекс Поиск"
                  autoFocus
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-400">Как клиент виден в системе.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Юридическое название</label>
                <input
                  value={nc.legalName}
                  onChange={(e) => setNc((s) => ({ ...s, legalName: e.target.value }))}
                  placeholder="ТОО «Яндекс.Казахстан»"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Форма компании *</label>
                <select
                  value={nc.form}
                  onChange={(e) => setNc((s) => ({ ...s, form: e.target.value as CompanyFormValue }))}
                  className={inputCls}
                >
                  {COMPANY_FORMS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Компания *</label>
                <select
                  value={nc.foreign}
                  onChange={(e) => setNc((s) => ({ ...s, foreign: e.target.value as "local" | "foreign" }))}
                  className={inputCls}
                >
                  <option value="local">Местная (резидент РК)</option>
                  <option value="foreign">Иностранная (нерезидент)</option>
                </select>
              </div>
            </div>

            <fieldset className="rounded-lg border border-gray-200 p-4">
              <legend className="px-1 text-sm font-medium text-gray-700">Банковские реквизиты</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">БИН</label>
                  <input
                    value={nc.bin}
                    onChange={(e) => {
                      // По законодательству РК БИН — ровно 12 цифр: лишнее не даём ввести.
                      const v = e.target.value.replace(/\D/g, "").slice(0, 12);
                      setNc((s) => ({ ...s, bin: v }));
                    }}
                    placeholder="123456789012"
                    inputMode="numeric"
                    maxLength={12}
                    className={inputCls}
                  />
                  <p className={`mt-1 text-xs ${nc.bin && nc.bin.length !== 12 ? "text-amber-600" : "text-gray-400"}`}>
                    {nc.bin ? `${nc.bin.length}/12 цифр` : "12 цифр; у иностранной компании может отсутствовать."}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Номер счёта (IBAN)</label>
                  <input
                    value={nc.account}
                    onChange={(e) => {
                      // IBAN: только буквы/цифры, капсом. Счёт РК (KZ…) — ровно 20
                      // знаков, иностранный — до 34 (ISO 13616).
                      let v = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "");
                      v = v.slice(0, v.startsWith("KZ") ? 20 : 34);
                      setNc((s) => ({ ...s, account: v }));
                    }}
                    placeholder="KZ000000000000000000"
                    maxLength={34}
                    className={inputCls}
                  />
                  <p className={`mt-1 text-xs ${nc.account.startsWith("KZ") && nc.account.length !== 20 ? "text-amber-600" : "text-gray-400"}`}>
                    {nc.account.startsWith("KZ")
                      ? `${nc.account.length}/20 знаков (счёт РК: KZ + 18)`
                      : "Счёт РК — 20 знаков (KZ + 18); иностранный — до 34."}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Банк</label>
                  <select
                    value={nc.bank}
                    onChange={(e) => setNc((s) => ({ ...s, bank: e.target.value }))}
                    className={inputCls}
                  >
                    <option value="">— выберите банк —</option>
                    {KZ_BANKS.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                    <option value="__other__">Другой банк (вручную)</option>
                  </select>
                  {nc.bank === "__other__" && (
                    <input
                      value={nc.bankOther}
                      onChange={(e) => setNc((s) => ({ ...s, bankOther: e.target.value }))}
                      placeholder="Название банка"
                      className={`${inputCls} mt-2`}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">КБЕ</label>
                  <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                    {kbeDescription(nc.form, nc.foreign === "foreign")}
                  </div>
                  <p className="mt-1 text-xs text-gray-400">Считается автоматически из формы компании и резидентства.</p>
                </div>
              </div>
            </fieldset>

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
                {projectCode(service, nextNumber)}
              </div>
              <p className="mt-1 text-xs text-gray-400">Присваивается системой автоматически — своя нумерация у каждого направления.</p>
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
              <label className="block text-sm font-medium text-gray-700">Дата утверждения проекта *</label>
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

          {/* Себестоимость: Influence — таблица блогеров; Продакшн — смета из Excel */}
          {isInfluence ? (
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
                          if (nb) {
                            // Смена блогера: опция остаётся; если она есть в прайсе
                            // нового блогера — гонорар подставляется по его цене.
                            const keep = nb.options.find((o) => o.name === r.optionName);
                            setRow(i, {
                              bloggerId: v,
                              name: nb.name,
                              optionName: keep ? r.optionName : r.optionName === "__custom__" ? "__custom__" : "",
                              fee: keep ? keep.priceWithTax : r.optionName === "__custom__" ? r.fee : "",
                            });
                          } else if (v === "__custom__") {
                            // «Не из базы»: опция переносится текстом, гонорар остаётся.
                            setRow(i, {
                              bloggerId: v,
                              name: "",
                              optionName: "",
                              custom: r.custom || (r.optionName && r.optionName !== "__custom__" ? r.optionName : ""),
                            });
                          } else {
                            setRow(i, { bloggerId: "", name: "", optionName: "", custom: "", fee: "" });
                          }
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
          ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700">Себестоимость проекта *</label>
            <div className="mt-2 rounded-lg border border-dashed border-gray-300 p-4">
              <p className="text-sm text-gray-600">
                Загрузите смету продюсера (файл .xlsx) — строки появятся ниже, их можно отредактировать перед созданием проекта.
              </p>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={onEstimateFile}
                  disabled={parsing}
                  className="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-indigo-700"
                />
                {parsing && <span className="text-sm text-gray-400">Читаю файл…</span>}
              </div>
              {parsedFrom && !parsing && (
                <p className="mt-1 text-xs text-green-700">Загружено из «{parsedFrom}» — проверьте и при необходимости поправьте строки.</p>
              )}
              {parseError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{parseError}</p>}
            </div>

            {/* Подписи колонок (как в шаблоне сметы) */}
            <div className="mt-3 flex items-center gap-2 pl-8 pr-6 text-[11px] uppercase text-gray-400">
              <span className="flex-1">Наименование работ</span>
              <span className="w-14 text-center">Шт.</span>
              <span className="w-14 text-center">Смен</span>
              <span className="w-32 text-right">Цена, ₸</span>
              <span className="w-36 text-right">Итого, ₸</span>
            </div>
            <div className="mt-1 space-y-1.5">
              {rows.map((r, i) => {
                const showSection = r.section && (i === 0 || rows[i - 1].section !== r.section);
                return (
                  <div key={i}>
                    {showSection && (
                      <p className="mb-1 mt-3 rounded bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-600">{r.section}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="w-6 text-right text-xs text-gray-400">{i + 1}.</span>
                      <input
                        placeholder="Статья себестоимости / подрядчик"
                        value={r.name}
                        onChange={(e) => setProdRow(i, { name: e.target.value })}
                        className={`${inputCls} mt-0 min-w-40 flex-1`}
                      />
                      <input
                        inputMode="numeric"
                        placeholder="шт"
                        title="Количество"
                        value={r.qty}
                        onChange={(e) => setProdRow(i, { qty: e.target.value })}
                        className={`${inputCls} mt-0 w-14 text-center`}
                      />
                      <input
                        inputMode="numeric"
                        placeholder="см."
                        title="Кол-во смен"
                        value={r.days}
                        onChange={(e) => setProdRow(i, { days: e.target.value })}
                        className={`${inputCls} mt-0 w-14 text-center`}
                      />
                      <input
                        inputMode="decimal"
                        placeholder="цена"
                        title="Цена за смену/шт."
                        value={r.rate}
                        onChange={(e) => setProdRow(i, { rate: e.target.value })}
                        className={`${inputCls} mt-0 w-32 text-right`}
                      />
                      <input
                        inputMode="decimal"
                        placeholder="Сумма, ₸"
                        value={r.fee}
                        onChange={(e) => setProdRow(i, { fee: e.target.value })}
                        className={`${inputCls} mt-0 w-36 text-right font-medium`}
                      />
                      {rows.length > 1 && (
                        <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600" title="Убрать">✕</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-gray-400">Кол-во × смены × цена пересчитывают «Итого» строки автоматически; сумму можно поправить и вручную.</p>
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { ...emptyRow, section: rs[rs.length - 1]?.section ?? "" }])}
              className="mt-2 text-sm text-indigo-600 hover:underline"
            >
              + Добавить строку
            </button>
          </div>
          )}

          {/* Живой расчёт экономики */}
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <div><p className="text-xs text-gray-500">НДС (16/116)</p><p className="font-medium">{fmt(totals.vat)}</p></div>
            <div><p className="text-xs text-gray-500">Без НДС</p><p className="font-medium">{fmt(totals.net)}</p></div>
            <div><p className="text-xs text-gray-500">Себестоимость</p><p className="font-medium">{fmt(totals.cost)}</p></div>
            {isInfluence && <div><p className="text-xs text-gray-500">Продакшн</p><p className="font-medium">{fmt(totals.reserves)}</p></div>}
            <div>
              <p className="text-xs text-gray-500">Маржа</p>
              <p className={`font-medium ${totals.margin < 0 ? "text-red-600" : "text-green-700"}`}>{fmt(totals.margin)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Маржа, %</p>
              <p className={`font-medium ${totals.margin < 0 ? "text-red-600" : "text-green-700"}`}>
                {totals.net > 0 ? `${((totals.margin / totals.net) * 100).toFixed(1)}%` : "—"}
              </p>
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
