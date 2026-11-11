"use client";

import { useState } from "react";

/**
 * "Onde foi o dinheiro": barra segmentada fina (as 5 maiores categorias + Outras)
 * sobre uma lista ranqueada. Cada linha da lista traz a amostra de cor, então a lista
 * faz o papel de legenda e de tabela (os valores ficam em texto, nunca só na cor).
 * Paleta categórica validada (ordem fixa, segura para daltonismo); "Outras" em cinza.
 */
const SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"];
const OTHER = "#b4bccb";

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
    ...top.map((r, i) => ({ key: r.key, name: `${r.icon} ${r.name}`, cents: r.cents, color: SLOTS[i] })),
    ...(restCents > 0 ? [{ key: "__outras", name: `Outras (${rest.length})`, cents: restCents, color: OTHER }] : []),
  ];
  const colorOf = (key: string) => segments.find((s) => s.key === key)?.color ?? OTHER;
  const activeSeg = segments.find((s) => s.key === active) ?? null;
  const shown = rows.slice(0, limit);

  return (
    <div className="grid gap-5">
      <div>
        <div
          className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full"
          role="img"
          aria-label={`Divisão dos gastos: ${segments.map((s) => `${s.name.replace(/^\S+\s/, "")} ${pctFmt((s.cents / total) * 100)}`).join(", ")}`}
        >
          {segments.map((s) => (
            <div
              key={s.key}
              onMouseEnter={() => setActive(s.key)}
              onMouseLeave={() => setActive(null)}
              className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(s.cents / total) * 100}%`, background: s.color, opacity: active && active !== s.key ? 0.35 : 1 }}
            />
          ))}
        </div>
        <p className="mt-2 h-5 text-xs text-ink-soft" aria-live="polite">
          {activeSeg ? (
            <>
              <span className="font-semibold text-ink">{activeSeg.name}</span> · {brl(activeSeg.cents)} · {pctFmt((activeSeg.cents / total) * 100)} do total
            </>
          ) : (
            "Passe o mouse ou toque numa categoria para destacar."
          )}
        </p>
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
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 rounded-xl px-2 py-2 outline-none transition-colors ${isActive ? "bg-paper" : ""}`}
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
