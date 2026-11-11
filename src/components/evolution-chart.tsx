"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const brl = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function EvolutionChart({ data }: { data: { label: string; income: number; expense: number }[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Gráfico de entradas e saídas por mês">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={4}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
          <YAxis tickFormatter={brl} tickLine={false} axisLine={false} width={80} tick={{ fill: "var(--chart-axis)", fontSize: 12 }} />
          <Tooltip formatter={(v) => brl(Number(v ?? 0))} cursor={{ fill: "var(--chart-grid)" }} contentStyle={{ borderRadius: 14, border: 0, background: "var(--chart-tip)", color: "var(--color-ink)", boxShadow: "var(--shadow-md)" }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="income" name="Entradas" fill="var(--color-gain)" radius={[8, 8, 0, 0]} />
          <Bar dataKey="expense" name="Saídas" fill="var(--color-loss)" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
