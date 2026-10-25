"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const brl = (v: number) => (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function EvolutionChart({ data }: { data: { label: string; income: number; expense: number }[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Gráfico de entradas e saídas por mês">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barGap={4}>
          <CartesianGrid vertical={false} stroke="#dfe3ea" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#4a5874", fontSize: 12 }} />
          <YAxis tickFormatter={brl} tickLine={false} axisLine={false} width={80} tick={{ fill: "#8a94a8", fontSize: 12 }} />
          <Tooltip formatter={(v) => brl(Number(v ?? 0))} cursor={{ fill: "#f5f6f8" }} contentStyle={{ borderRadius: 12, borderColor: "#dfe3ea" }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
          <Bar dataKey="income" name="Entradas" fill="#1e7a4c" radius={[6, 6, 0, 0]} />
          <Bar dataKey="expense" name="Saídas" fill="#b3261e" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
