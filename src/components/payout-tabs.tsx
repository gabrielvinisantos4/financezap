"use client";

import { useState } from "react";

/** Escolha de como o afiliado recebe: carteira do Asaas (split automático) ou Pix mensal. */
export function PayoutTabs({ initial, asaas, pix }: { initial: "asaas" | "pix"; asaas: React.ReactNode; pix: React.ReactNode }) {
  const [tab, setTab] = useState(initial);
  const btn = (t: "asaas" | "pix", label: string, hint: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`flex-1 rounded-[14px] px-3 py-2.5 text-left text-sm transition ${tab === t ? "lg-tint font-semibold text-gain" : "lg-ghost text-ink-soft"}`}
    >
      {label}
      <small className="block text-xs font-normal text-ink-faint">{hint}</small>
    </button>
  );
  return (
    <div className="grid gap-4">
      <div role="tablist" className="flex gap-2 rounded-[18px] bg-paper p-1.5">
        {btn("asaas", "Conta Asaas", "Automático, a cada pagamento")}
        {btn("pix", "Pix em qualquer banco", "Uma vez por mês")}
      </div>
      <div role="tabpanel">{tab === "asaas" ? asaas : pix}</div>
    </div>
  );
}
