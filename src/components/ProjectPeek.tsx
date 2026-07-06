"use client";

// Кликабельное название проекта: по клику — попап со статусом проекта
// (смета, маржа, поступления, кто оплачен и на сколько %). Полные детали
// показываются только тем, кому проект виден по скоупу §10 — решает сервер
// (peekProject); остальным попап отдаёт «шапку» без денег сделки.

import { useEffect, useState } from "react";
import Link from "next/link";
import { peekProject, type ProjectPeekResult } from "@/lib/projects/actions";

export function ProjectPeek({ projectId, children, className }: { projectId: string; children: React.ReactNode; className?: string }) {
  // Гидрация: до mounted клик по кнопке молча теряется — не даём «мёртвых» кликов.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ProjectPeekResult | null>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function show() {
    setOpen(true);
    if (!data) setData(await peekProject(projectId));
  }

  return (
    <>
      <button
        type="button"
        disabled={!mounted}
        onClick={show}
        title="Статус проекта"
        className={className ?? "inline text-left text-indigo-600 hover:underline"}
      >
        {children}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {!data && <p className="py-8 text-center text-sm text-gray-400">Загрузка…</p>}

            {data && data.access === "none" && (
              <p className="py-8 text-center text-sm text-gray-400">Проект не найден.</p>
            )}

            {data && data.access !== "none" && (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-gray-900">
                      <span className="mr-1.5 text-gray-400">{data.code}</span>
                      {data.name}
                    </p>
                    <p className="mt-0.5 text-sm text-gray-500">
                      {data.clientName ? `${data.clientName} · ` : ""}
                      {data.serviceLabel} ·{" "}
                      <span className={data.statusLabel === "активен" ? "text-green-700" : "text-gray-600"}>{data.statusLabel}</span>
                    </p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" title="Закрыть">
                    ✕
                  </button>
                </div>

                {data.access === "limited" && (
                  <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                    Детали проекта (смета, суммы, получатели) доступны владельцу сделки, проджекту и финансам.
                  </p>
                )}

                {data.access === "full" && (
                  <>
                    <p className="mt-1 text-xs text-gray-400">
                      Продажник: {data.ownerName ?? "—"} · Проджект: {data.pmName ?? "—"}
                      {data.approvedAt ? ` · утверждён ${data.approvedAt}` : ""}
                      {data.completionAt ? ` · план. завершение ${data.completionAt}` : ""}
                    </p>

                    {!data.hasEstimate ? (
                      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700">У проекта пока нет сметы.</p>
                    ) : (
                      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        <Cell label="Цена клиенту" value={data.price ?? "—"} />
                        <Cell
                          label="Поступило"
                          value={data.received}
                          sub={data.receivedPct != null ? `${data.receivedPct}%` : undefined}
                          accent="text-green-700"
                        />
                        <Cell label="Дебиторка" value={data.receivable ?? "—"} accent={data.receivable ? "text-amber-700" : undefined} />
                        <Cell label="Себестоимость" value={data.cost ?? "—"} />
                        <Cell
                          label="Маржа"
                          value={data.margin ?? "—"}
                          sub={data.marginPct != null ? `${data.marginPct}%` : undefined}
                          accent="text-green-700"
                        />
                        {data.reserve ? <Cell label="Продакшн-резерв" value={data.reserve} /> : <Cell label="Выплачено" value={data.paidTotal} />}
                      </div>
                    )}

                    {data.positions.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-1.5 text-xs font-medium uppercase text-gray-500">
                          Получатели и позиции · оплачено {data.paidCount} из {data.recipientsTotal}
                        </p>
                        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                          {data.positions.map((p, i) => (
                            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                              <div className="min-w-0">
                                <p className="truncate text-gray-800">{p.title}</p>
                                {p.option && <p className="truncate text-xs text-gray-400">{p.option}</p>}
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="text-gray-800">
                                  {p.planned}
                                  {p.reserve && <span className="ml-1 text-xs text-gray-400">+ резерв {p.reserve}</span>}
                                </p>
                                {p.paid != null &&
                                  (p.isPaid ? (
                                    <p className="text-xs text-green-700">✓ оплачено {p.paid}{p.pct != null ? ` (${p.pct}%)` : ""}</p>
                                  ) : (
                                    <p className="text-xs text-gray-400">не оплачен</p>
                                  ))}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {data.canOpenCard && (
                      <div className="mt-4 text-right">
                        <Link href={`/projects/${data.projectId}`} className="text-sm font-medium text-indigo-600 hover:underline">
                          Открыть карточку проекта →
                        </Link>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Cell({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-semibold ${accent ?? "text-gray-900"}`}>
        {value}
        {sub && <span className="ml-1 text-xs font-normal text-gray-400">{sub}</span>}
      </p>
    </div>
  );
}
