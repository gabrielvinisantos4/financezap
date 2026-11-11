"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Ritmo de gastos: total acumulado dia a dia no mês atual (cor de destaque) contra o
 * mês anterior (cinza tracejado). Um eixo só. Se houver limite total do mês, ele
 * aparece como linha de referência.
 */
export type PacePoint = { day: number; current: number | null; previous: number | null };

const ACCENT = "#2a78d6";
const MUTED = "#8a94a8";
const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compact = (c: number) => {
  const v = c / 100;
  return v >= 1000 ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(v)}`;
};

export function SpendingPace({ data, currentLabel, previousLabel, limitCents }: { data: PacePoint[]; currentLabel: string; previousLabel: string; limitCents?: number | null }) {
  return (
    <div className="grid gap-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft" aria-label="Legenda">
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded-full" style={{ background: ACCENT }} aria-hidden /> {currentLabel}
        </li>
        <li className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed" style={{ borderColor: MUTED }} aria-hidden /> {previousLabel}
        </li>
        {limitCents ? (
          <li className="flex items-center gap-2">
            <span className="w-5 border-t-2 border-dotted border-loss" aria-hidden /> Limite do mês
          </li>
        ) : null}
      </ul>
      <div className="h-64 w-full" role="img" aria-label={`Gasto acumulado por dia: ${currentLabel} comparado a ${previousLabel}`}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#eceff4" />
            <XAxis dataKey="day" tickLine={false} axisLine={{ stroke: "#dfe3ea" }} tick={{ fill: "#8a94a8", fontSize: 12 }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={72} tick={{ fill: "#8a94a8", fontSize: 12 }} />
            <Tooltip
              cursor={{ stroke: "#c3cad6", strokeWidth: 1 }}
              contentStyle={{ borderRadius: 12, borderColor: "#dfe3ea", fontSize: 13, boxShadow: "0 8px 24px rgba(27,42,74,.08)" }}
              labelFormatter={(d) => `Dia ${d}`}
              formatter={(v, name) => [brl(Number(v ?? 0)), name === "current" ? currentLabel : previousLabel]}
            />
            {limitCents ? <ReferenceLine y={limitCents} stroke="#b3261e" strokeDasharray="2 4" ifOverflow="extendDomain" /> : null}
            <Line type="monotone" dataKey="previous" stroke={MUTED} strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} connectNulls />
            <Line type="monotone" dataKey="current" stroke={ACCENT} strokeWidth={2.5} dot={false} activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
