"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./forms";
import { checkoutAction } from "@/app/actions/app";

type P = { slug: string; name: string; monthly: string; yearly: string; features: string[] };

export function CheckoutForm({ plans, initial }: { plans: P[]; initial?: string }) {
  const [plan, setPlan] = useState(plans.find((p) => p.slug === initial)?.slug ?? plans[0]?.slug);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  return (
    <ActionForm action={checkoutAction}>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink-soft">Plano</legend>
        {plans.map((p) => (
          <label key={p.slug} className={`cursor-pointer rounded-xl border p-4 ${plan === p.slug ? "border-ink bg-paper" : "border-line"}`}>
            <input type="radio" name="plan" value={p.slug} checked={plan === p.slug} onChange={() => setPlan(p.slug)} className="sr-only" />
            <span className="wide block">{p.name}</span>
            <span className="money text-sm text-ink-soft">{cycle === "monthly" ? `${p.monthly}/mês` : `${p.yearly}/ano`}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="grid w-fit grid-cols-2 gap-1 rounded-full bg-paper p-1">
        <legend className="sr-only">Cobrança</legend>
        {(["monthly", "yearly"] as const).map((c) => (
          <label key={c} className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-semibold ${cycle === c ? "bg-ink text-white" : "text-ink-soft"}`}>
            <input type="radio" name="cycle" value={c} checked={cycle === c} onChange={() => setCycle(c)} className="sr-only" />
            {c === "monthly" ? "Mensal" : "Anual"}
          </label>
        ))}
      </fieldset>
      <label className="field max-w-xs">
        <span>CPF ou CNPJ</span>
        <input className="input" name="cpfCnpj" inputMode="numeric" autoComplete="off" required />
        <small className="text-ink-faint">Exigido pelo Asaas para emitir a cobrança. Não fica guardado no FinanceZap.</small>
      </label>
      <Submit className="btn btn-coin w-fit" pendingText="Gerando cobrança…">Ir para o pagamento</Submit>
      <p className="text-sm text-ink-soft">Você escolhe Pix, boleto ou cartão na página segura do Asaas. O acesso é liberado assim que o pagamento é confirmado.</p>
    </ActionForm>
  );
}
