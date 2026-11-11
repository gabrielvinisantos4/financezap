"use client";

import { useState } from "react";

/**
 * "Para onde vai seu dinheiro": rosca com as 5 maiores categorias + Outras,
 * ao lado de uma lista ranqueada. Cada linha da lista traz a amostra de cor, então a lista
 * faz o papel de legenda e de tabela (os valores ficam em texto, nunca só na cor).
 * Paleta categórica validada (ordem fixa, segura para daltonismo); "Outras" em cinza.
 */
const SLOTS = ["#16a34a", "#3b82f6", "#f59e0b", "#a78bfa", "#ec6a9c"];
const OTHER = "#b7c0bc";

export type BreakdownRow = { key: string; name: string; icon: string; cents: number; prevCents: number };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctFmt = (v: number) => `${v < 10 && v > 0 ? v.toFixed(1).replace(".", ",") : Math.round(v)}%`;

export function SpendingBreakdown({ rows, prevLabel, limit = 10 }: { rows: BreakdownRow[]; prevLabel: string; limit?: number }) {
  const [active, setActive] = useState<string | null>(null);
  const total = rows.reduce((s, r) => s + r.cents, 0);
  if (!total) return null;

  const top = rows.slice(0, SLOTS.length);
  const rest = rows.slice(SLOTS.length);
  const restCents = rest.reduce((s, r) => s + r.cents, 0);
  const segments = [
    ...top.map((r, i) => ({ key: r.key, name: `${r.icon} ${r.name}`, label: r.name, cents: r.cents, color: SLOTS[i] })),
    ...(restCents > 0 ? [{ key: "__outras", name: `Outras (${rest.length})`, label: `Outras (${rest.length})`, cents: restCents, color: OTHER }] : []),
  ];
  const colorOf = (key: string) => segments.find((s) => s.key === key)?.color ?? OTHER;
  const activeSeg = segments.find((s) => s.key === active) ?? null;
  const shown = rows.slice(0, limit);

  const size = 176;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="grid gap-5">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={`Divisão dos gastos: ${segments.map((sg) => `${sg.label} ${pctFmt((sg.cents / total) * 100)}`).join(", ")}`}
          >
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
            {segments.map((sg) => {
              const len = (sg.cents / total) * c;
              const gap = segments.length > 1 ? 3 : 0;
              const el = (
                <circle
                  key={sg.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={sg.color}
                  strokeWidth={active === sg.key ? stroke + 4 : stroke}
                  strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`}
                  strokeDashoffset={-acc}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  style={{ opacity: active && active !== sg.key ? 0.3 : 1, transition: "opacity .2s, stroke-width .2s", cursor: "pointer" }}
                  onMouseEnter={() => setActive(sg.key)}
                  onMouseLeave={() => setActive(null)}
                />
              );
              acc += len;
              return el;
            })}
          </svg>
          <div className="pointer-events-none absolute inset-0 grid place-content-center px-6 text-center" aria-live="polite">
            <p className="money text-[1.15rem] font-bold tracking-[-0.03em]">{brl(activeSeg ? activeSeg.cents : total)}</p>
            <p className="truncate text-[0.72rem] text-ink-faint">{activeSeg ? `${activeSeg.label} · ${pctFmt((activeSeg.cents / total) * 100)}` : "gastos do mês"}</p>
          </div>
        </div>
        <ul className="grid w-full gap-2.5 text-sm">
          {segments.map((sg) => (
            <li
              key={sg.key}
              className="grid grid-cols-[10px_1fr_auto] items-center gap-2.5"
              onMouseEnter={() => setActive(sg.key)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: sg.color }} aria-hidden />
              <span className="truncate text-ink-soft">{sg.label}</span>
              <b className="tabular-nums">{pctFmt((sg.cents / total) * 100)}</b>
            </li>
          ))}
        </ul>
      </div>

      <ul className="grid gap-1">
        {shown.map((r) => {
          const share = (r.cents / total) * 100;
          const delta = r.prevCents > 0 ? ((r.cents - r.prevCents) / r.prevCents) * 100 : null;
          const isActive = active === r.key || (active === "__outras" && rest.some((x) => x.key === r.key));
          return (
            <li
              key={r.key}
              tabIndex={0}
              onMouseEnter={() => setActive(top.some((t) => t.key === r.key) ? r.key : "__outras")}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(top.some((t) => t.key === r.key) ? r.key : "__outras")}
              onBlur={() => setActive(null)}
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-[14px] px-2.5 py-2 outline-none transition-colors ${isActive ? "bg-paper" : ""}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf(r.key) }} aria-hidden />
              <span className="min-w-0 truncate text-sm">
                {r.icon} {r.name}
              </span>
              <span className="money text-right text-sm font-semibold tabular-nums">{brl(r.cents)}</span>
              <span aria-hidden />
              <div className="h-1.5 rounded-full bg-paper" aria-hidden>
                <div className="h-1.5 rounded-full" style={{ width: `${Math.max(1.5, share)}%`, background: colorOf(r.key) }} />
              </div>
              <span className="text-right text-xs tabular-nums text-ink-soft">
                {pctFmt(share)}
                {delta !== null && Math.abs(delta) >= 1 && (
                  <span className={delta > 0 ? "text-loss" : "text-gain"} title={`vs ${prevLabel}`}>
                    {" "}
                    · {delta > 0 ? "▲" : "▼"} {Math.round(Math.abs(delta))}%
                  </span>
                )}
                {r.prevCents === 0 && <span className="text-ink-faint"> · novo</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length && <p className="text-xs text-ink-faint">+ {rows.length - shown.length} categorias menores no relatório do mês.</p>}
      <p className="text-xs text-ink-faint">▲▼ comparado ao mesmo período de {prevLabel}.</p>
    </div>
  );
}
