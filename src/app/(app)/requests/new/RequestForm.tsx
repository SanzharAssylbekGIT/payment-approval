"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CreateState } from "@/lib/requests/actions";
import { URGENCY_LABELS, URGENCY_HINTS, DELIVERABLE_LABELS, PAYMENT_TIMING_LABELS, ATTACHMENT_KIND_LABELS, BLOGGER_FEE_CODE } from "@/lib/requests/status";
import { minPayDateForUrgency, toDateInputValue, nextThursday, thursdayOnOrAfter } from "@/lib/requests/urgency";
import { tiynToInputString } from "@/lib/money";
import type { Urgency, PaymentTiming, BloggerDeliverable, ServiceType, AttachmentKind } from "@prisma/client";

interface ExpenseTypeOpt {
  id: string;
  code: string;
  name: string;
  isProjectCost: boolean;
  requiresEstimate: boolean;
  serviceType: ServiceType | null;
  defaultUrgency: Urgency;
}
interface ProjectOpt {
  id: string;
  name: string;
  clientName: string | null;
  serviceType: string;
  recipients: { id: string; name: string }[];
  estimateLines: { id: string; kind: string; title: string; option: string | null; plannedAmount: string; recipientId: string | null }[];
}

// Начальные значения для режима редактирования (все суммы — строки в тенге).
export interface RequestInitial {
  expenseTypeId: string;
  projectId: string;
  recipientId: string;
  estimateLineId: string;
  estimateLineIds: string[]; // мультивыбор позиций сметы (продакшн)
  amount: string;
  contractAmount: string;
  paymentPercent: string;
  paymentTiming: PaymentTiming | "";
  serviceRendered: boolean;
  deliverables: BloggerDeliverable[];
  purpose: string;
  urgency: Urgency;
  desiredPayDate: string;
  comment: string;
}

const initialState: CreateState = {};
const inputCls =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

const DELIVERABLE_KEYS = Object.keys(DELIVERABLE_LABELS) as BloggerDeliverable[];
const URGENCY_KEYS = Object.keys(URGENCY_LABELS) as Urgency[];

function formatTengeInput(tenge: number): string {
  if (!Number.isFinite(tenge) || tenge <= 0) return "0 ₸";
  return `${Math.round(tenge).toLocaleString("ru-RU").replace(/,/g, " ")} ₸`;
}

export function RequestForm({
  expenseTypes,
  projects,
  action,
  initial,
  existingAttachments,
}: {
  expenseTypes: ExpenseTypeOpt[];
  projects: ProjectOpt[];
  action: (prev: CreateState, formData: FormData) => Promise<CreateState>;
  initial?: RequestInitial;
  existingAttachments?: { id: string; kind: AttachmentKind; fileName: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const intentRef = useRef<HTMLInputElement>(null);

  const [expenseTypeId, setExpenseTypeId] = useState(initial?.expenseTypeId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [recipientId, setRecipientId] = useState(initial?.recipientId ?? "");
  const [estimateLineId, setEstimateLineId] = useState(initial?.estimateLineId ?? "");
  const [lineIds, setLineIds] = useState<string[]>(initial?.estimateLineIds ?? []);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [urgency, setUrgency] = useState<Urgency>(initial?.urgency ?? "NOT_URGENT");
  const [desiredPayDate, setDesiredPayDate] = useState(initial?.desiredPayDate ?? "");
  const [contractAmount, setContractAmount] = useState(initial?.contractAmount ?? "");
  const [paymentPercent, setPaymentPercent] = useState(initial?.paymentPercent ?? "");
  const [serviceRendered, setServiceRendered] = useState(initial?.serviceRendered ?? false);

  const [mounted, setMounted] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [guardHref, setGuardHref] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const selectedType = expenseTypes.find((e) => e.id === expenseTypeId);
  const isProjectCost = selectedType?.isProjectCost ?? false;
  const isBlogger = selectedType?.code === BLOGGER_FEE_CODE;
  const visibleProjects = useMemo(
    () => projects.filter((p) => !selectedType?.serviceType || p.serviceType === selectedType.serviceType),
    [projects, selectedType],
  );
  const selectedProject = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  // Утверждённые опции проекта (строки сметы блогер × опция) — для дропдауна
  // «Формат работ» гонорара блогера. Если блогер выбран — только его опции.
  const projectHasOptions = useMemo(
    () => (selectedProject?.estimateLines ?? []).some((l) => l.kind === "RECIPIENT"),
    [selectedProject],
  );
  const approvedOptions = useMemo(() => {
    const lines = (selectedProject?.estimateLines ?? []).filter((l) => l.kind === "RECIPIENT");
    return recipientId ? lines.filter((l) => l.recipientId === recipientId) : lines;
  }, [selectedProject, recipientId]);

  // Плановые выплаты блогерам — по четвергам (реестр раз в неделю); «Срочно» —
  // единственный способ вне четверга.
  const isBloggerPlan = isBlogger && urgency !== "URGENT";

  // Минимальная желаемая дата. Считаем только на клиенте (после маунта) —
  // иначе SSR (часовой пояс сервера) и гидрация могут разойтись.
  const minDate = mounted
    ? isBloggerPlan
      ? toDateInputValue(new Date())
      : toDateInputValue(minPayDateForUrgency(urgency))
    : "";

  function parseDateStr(s: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  // При смене срочности: блогер-плановая — дата примагничивается к четвергу;
  // иначе чистим дату, только если она стала раньше нового минимума.
  function onUrgencyChange(next: Urgency) {
    setUrgency(next);
    if (isBlogger && next !== "URGENT") {
      setDesiredPayDate((cur) => {
        const dt = cur ? parseDateStr(cur) : null;
        if (!dt || dt.getDay() !== 4 || dt < new Date(new Date().setHours(0, 0, 0, 0))) {
          return toDateInputValue(nextThursday());
        }
        return cur;
      });
      return;
    }
    const nm = toDateInputValue(minPayDateForUrgency(next));
    setDesiredPayDate((cur) => (cur && cur < nm ? "" : cur));
  }

  // Дата: для блогер-плановой не-четверг сдвигается на ближайший четверг.
  function onDateChange(v: string) {
    if (isBloggerPlan && v) {
      const dt = parseDateStr(v);
      if (dt && dt.getDay() !== 4) {
        setDesiredPayDate(toDateInputValue(thursdayOnOrAfter(dt)));
        return;
      }
    }
    setDesiredPayDate(v);
  }

  // Выбор утверждённой опции: подставляем блогера строки и (если пусто)
  // сумму по договору = гонорар из сметы.
  function onOptionChange(v: string) {
    setEstimateLineId(v);
    const line = selectedProject?.estimateLines.find((l) => l.id === v);
    if (line?.recipientId) setRecipientId(line.recipientId);
    if (line && !contractAmount.trim()) setContractAmount(tiynToInputString(BigInt(line.plannedAmount)));
  }

  // Продакшн: мультивыбор позиций сметы — одной заявкой можно оплатить
  // несколько позиций разом. Сумма и назначение подставляются автоматически.
  const AUTO_PURPOSE = "Оплата по смете: ";
  function toggleLine(id: string) {
    const next = lineIds.includes(id) ? lineIds.filter((x) => x !== id) : [...lineIds, id];
    setLineIds(next);
    const lines = (selectedProject?.estimateLines ?? []).filter((l) => next.includes(l.id));
    if (lines.length > 0) {
      setAmount(tiynToInputString(lines.reduce((s, l) => s + BigInt(l.plannedAmount), 0n)));
    }
    setPurpose((p) => (!p.trim() || p.startsWith(AUTO_PURPOSE)) && lines.length > 0
      ? AUTO_PURPOSE + lines.map((l) => l.title).join(", ")
      : p);
    if (lines.length === 1 && lines[0].recipientId) setRecipientId(lines[0].recipientId);
  }

  // Черновики/префилл блогера: срочность приводим к «плановая/срочно», дата —
  // ближайший четверг, если не задана. Только на клиенте после маунта.
  useEffect(() => {
    if (!mounted || !isBlogger) return;
    if (urgency !== "URGENT" && urgency !== "NOT_URGENT") setUrgency("NOT_URGENT");
    if (urgency !== "URGENT" && !desiredPayDate) setDesiredPayDate(toDateInputValue(nextThursday()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isBlogger]);

  // Предпросмотр суммы к оплате блогеру = договор × %.
  const bloggerAmountPreview = useMemo(() => {
    const c = Number(String(contractAmount).replace(/\s/g, "").replace(",", "."));
    const p = Number(paymentPercent);
    if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
    return formatTengeInput((c * p) / 100);
  }, [contractAmount, paymentPercent]);

  // --- Защита от потери несохранённых данных ---
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && !pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, pending]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (pending) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      e.preventDefault();
      e.stopPropagation();
      setGuardHref(href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, pending]);

  function doSubmit(intent: "draft" | "submit") {
    if (intentRef.current) intentRef.current.value = intent;
    setDirty(false);
    formRef.current?.requestSubmit();
  }

  function discardAndLeave() {
    const href = guardHref;
    setDirty(false);
    setGuardHref(null);
    if (href) router.push(href);
  }

  return (
    <>
      <form ref={formRef} action={formAction} onInput={() => setDirty(true)} className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
        <input type="hidden" name="intent" ref={intentRef} defaultValue="draft" />

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
              const blogger = t?.code === BLOGGER_FEE_CODE;
              if (t) setUrgency(blogger ? "NOT_URGENT" : t.defaultUrgency);
              // Блогеры: плановая выплата — ближайший четверг (авто).
              if (blogger) setDesiredPayDate(toDateInputValue(nextThursday()));
              setProjectId("");
              setRecipientId("");
              setEstimateLineId("");
              setLineIds([]);
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

        {/* Проект (фильтруется по услуге вида расхода) */}
        {isProjectCost && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">Проект *</label>
              <select
                name="projectId"
                required
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setRecipientId("");
                  setEstimateLineId("");
                  setLineIds([]);
                }}
                className={inputCls}
              >
                <option value="">— выберите проект —</option>
                {visibleProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.clientName ? `${p.clientName} · ${p.name}` : p.name}
                  </option>
                ))}
              </select>
              {visibleProjects.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">Нет доступных проектов этого вида — обратитесь к ответственному за учёт.</p>
              )}
            </div>

            {selectedProject && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{isBlogger ? "Блогер" : "Получатель"}</label>
                  <select
                    name="recipientId"
                    className={inputCls}
                    value={recipientId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRecipientId(v);
                      // Выбранная опция другого блогера больше не подходит.
                      const line = selectedProject.estimateLines.find((l) => l.id === estimateLineId);
                      if (line && v && line.recipientId && line.recipientId !== v) setEstimateLineId("");
                    }}
                  >
                    <option value="">— не указан —</option>
                    {selectedProject.recipients.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Позиции сметы — для всех проектных видов, КРОМЕ блогера.
                Мультивыбор: одной заявкой можно оплатить несколько позиций. */}
            {selectedProject && !isBlogger && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Позиции сметы (можно несколько)</label>
                {selectedProject.estimateLines.filter((l) => l.kind === "RECIPIENT").length === 0 ? (
                  <p className="mt-1 text-sm text-gray-400">У проекта пока нет позиций сметы.</p>
                ) : (
                  <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-3">
                    {selectedProject.estimateLines
                      .filter((l) => l.kind === "RECIPIENT")
                      .map((l) => (
                        <label key={l.id} className="flex cursor-pointer items-center justify-between gap-3 rounded px-1 py-0.5 text-sm hover:bg-gray-50">
                          <span className="flex items-center gap-2 text-gray-700">
                            <input
                              type="checkbox"
                              name="estimateLineIds"
                              value={l.id}
                              checked={lineIds.includes(l.id)}
                              onChange={() => toggleLine(l.id)}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            {l.title}
                            {l.option ? <span className="text-xs text-gray-400">{l.option}</span> : null}
                          </span>
                          <span className="whitespace-nowrap text-gray-500">{formatTengeInput(Number(l.plannedAmount) / 100)}</span>
                        </label>
                      ))}
                  </div>
                )}
                <p className="mt-1 text-xs text-gray-400">
                  Отметьте одну или несколько позиций — сумма заявки и назначение платежа подставятся автоматически (их можно поправить).
                </p>
              </div>
            )}
          </>
        )}

        {/* === Блок блогера === */}
        {isBlogger ? (
          <div className="space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
            {/* Формат работ: утверждённая опция из сметы проекта (дропдаун).
                Фолбэк на чекбоксы — только для старых проектов без строк сметы. */}
            {selectedProject && projectHasOptions ? (
              <div>
                <label className="block text-sm font-medium text-gray-700">Формат работ — утверждённая опция *</label>
                <select
                  name="estimateLineId"
                  required
                  value={estimateLineId}
                  onChange={(e) => onOptionChange(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— выберите опцию из сметы проекта —</option>
                  {approvedOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                      {l.option ? ` — ${l.option}` : ""} — {formatTengeInput(Number(l.plannedAmount) / 100)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">
                  Опции подтягиваются из утверждённой сметы проекта{recipientId ? " для выбранного блогера" : ""}; выбор опции подставит блогера и гонорар.
                </p>
                {approvedOptions.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">У выбранного блогера нет опций в смете — выберите другого или проверьте смету проекта.</p>
                )}
              </div>
            ) : selectedProject ? (
              <div>
                <label className="block text-sm font-medium text-gray-700">Форматы работ</label>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {DELIVERABLE_KEYS.map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        name="deliverables"
                        value={d}
                        defaultChecked={initial?.deliverables?.includes(d) ?? false}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      {DELIVERABLE_LABELS[d]}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Сначала выберите проект — форматы работ подтянутся из его сметы.</p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Сумма по договору, ₸ *</label>
                <input
                  name="contractAmount"
                  inputMode="decimal"
                  required
                  placeholder="500 000"
                  value={contractAmount}
                  onChange={(e) => setContractAmount(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">% от оплаты *</label>
                <input
                  name="paymentPercent"
                  type="number"
                  min={1}
                  max={100}
                  required
                  placeholder="50"
                  value={paymentPercent}
                  onChange={(e) => setPaymentPercent(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Сумма к оплате: <span className="font-semibold text-gray-900">{bloggerAmountPreview ?? "—"}</span>
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Оплата</label>
                <div className="mt-2 flex gap-4 text-sm text-gray-700">
                  {(Object.keys(PAYMENT_TIMING_LABELS) as PaymentTiming[]).map((t) => (
                    <label key={t} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="paymentTiming"
                        value={t}
                        defaultChecked={(initial?.paymentTiming ?? "PREPAY") === t}
                        className="border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      {PAYMENT_TIMING_LABELS[t]}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 pt-6 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    name="serviceRendered"
                    checked={serviceRendered}
                    onChange={(e) => setServiceRendered(e.target.checked)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Услуга оказана
                </label>
              </div>
            </div>
          </div>
        ) : (
          /* === Обычная заявка: сумма + назначение === */
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">Сумма, ₸ *</label>
              <input name="amount" inputMode="decimal" placeholder="350 000" required value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Назначение платежа *</label>
              <input name="purpose" required placeholder="За что платим" value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls} />
            </div>
          </>
        )}

        {/* Срочность + дата. Блогеры: плановые выплаты — по четвергам,
            «Срочно» (1 раб. день) — вне четверга. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Срочность</label>
            {isBlogger ? (
              <select name="urgency" value={urgency} onChange={(e) => onUrgencyChange(e.target.value as Urgency)} className={inputCls}>
                <option value="NOT_URGENT">Плановая — ближайший четверг</option>
                <option value="URGENT">Срочно — 1 рабочий день</option>
              </select>
            ) : (
              <select name="urgency" value={urgency} onChange={(e) => onUrgencyChange(e.target.value as Urgency)} className={inputCls}>
                {URGENCY_KEYS.map((u) => (
                  <option key={u} value={u}>
                    {URGENCY_LABELS[u]} — {URGENCY_HINTS[u]}
                  </option>
                ))}
              </select>
            )}
            {isBlogger && (
              <p className="mt-1 text-xs text-gray-400">Выплаты блогерам проводятся раз в неделю — по четвергам.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Желаемая дата оплаты</label>
            <input
              name="desiredPayDate"
              type="date"
              min={minDate || undefined}
              value={desiredPayDate}
              onChange={(e) => onDateChange(e.target.value)}
              className={inputCls}
            />
            {isBloggerPlan ? (
              <p className="mt-1 text-xs text-gray-400">Только четверг — другая дата сдвинется на ближайший четверг.</p>
            ) : (
              minDate && (
                <p className="mt-1 text-xs text-gray-400">Не раньше {minDate.split("-").reverse().join(".")} ({URGENCY_HINTS[urgency]})</p>
              )
            )}
          </div>
        </div>

        {/* Вложения по категориям */}
        <div className="space-y-3 rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-medium text-gray-700">Вложения</p>
          {existingAttachments && existingAttachments.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
              {existingAttachments.map((a) => (
                <li key={a.id}>
                  ✓ {ATTACHMENT_KIND_LABELS[a.kind]}: {a.fileName}
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FileField name="file_contract" label="Договор" />
            <FileField name="file_invoice" label="Счёт" />
            {isBlogger && (
              <>
                <FileField name="file_act" label={`Акт выполненных работ${serviceRendered ? " *" : ""}`} />
                <FileField name="file_residency" label="Сертификат резидентства" />
              </>
            )}
          </div>
          {isBlogger && serviceRendered && (
            <p className="text-xs text-amber-600">Услуга отмечена как оказанная — при отправке нужен подписанный акт.</p>
          )}
        </div>

        {/* Комментарий */}
        <div>
          <label className="block text-sm font-medium text-gray-700">Комментарий</label>
          <textarea name="comment" rows={2} placeholder="Дополнительная информация" defaultValue={initial?.comment ?? ""} className={inputCls} />
        </div>

        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => doSubmit("draft")}
            disabled={pending}
            className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {pending ? "Сохранение…" : "Сохранить черновик"}
          </button>
          <button
            type="button"
            onClick={() => doSubmit("submit")}
            disabled={pending}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? "Отправка…" : "Отправить"}
          </button>
        </div>
      </form>

      {/* Модалка потери несохранённых данных */}
      {guardHref && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Несохранённые данные</h3>
            <p className="mt-2 text-sm text-gray-600">
              Если уйти со страницы, введённые данные будут удалены. Сохранить как черновик или удалить?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={discardAndLeave}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Удалить
              </button>
              <button
                onClick={() => { setGuardHref(null); doSubmit("draft"); }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Сохранить черновик
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FileField({ name, label }: { name: string; label: string }) {
  return (
    <div>
      <label className="block text-sm text-gray-600">{label}</label>
      <input
        name={name}
        type="file"
        className="mt-1 w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
      />
    </div>
  );
}
