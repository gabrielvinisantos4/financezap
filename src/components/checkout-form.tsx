"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./forms";
import { checkoutAction } from "@/app/actions/app";

type P = { slug: string; name: string; description: string; monthly: string; yearly: string; yearlySavings: string | null; features: string[] };

function cpfMask(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}

export function CheckoutForm({ plans, initial, trialUntil = null, pixTrialUntil = null, inTrial = false }: { plans: P[]; initial?: string; trialUntil?: string | null; pixTrialUntil?: string | null; inTrial?: boolean }) {
  const [plan, setPlan] = useState(plans.find((p) => p.slug === initial)?.slug ?? plans[Math.min(1, plans.length - 1)]?.slug);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [method, setMethod] = useState<"credit_card" | "pix">("credit_card");
  const [doc, setDoc] = useState("");
  const selected = plans.find((p) => p.slug === plan);

  return (
    <ActionForm action={checkoutAction} className="grid gap-6">
      <fieldset className="grid w-fit grid-cols-2 gap-1 rounded-full bg-paper p-1">
        <legend className="sr-only">Cobrança</legend>
        {(["monthly", "yearly"] as const).map((c) => (
          <label key={c} className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-semibold ${cycle === c ? "lg-btn text-ink" : "text-ink-soft"}`}>
            <input type="radio" name="cycle" value={c} checked={cycle === c} onChange={() => setCycle(c)} className="sr-only" />
            {c === "monthly" ? "Mensal" : "Anual"}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">1. Escolha o plano</legend>
        {plans.map((p) => (
          <label key={p.slug} className={`flex cursor-pointer flex-col rounded-[24px] bg-surface p-5 transition-shadow ${plan === p.slug ? "shadow-[inset_0_0_0_2px_var(--color-gain)]" : "shadow-[inset_0_0_0_1px_var(--hair-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-gain)]"}`}>
            <input type="radio" name="plan" value={p.slug} checked={plan === p.slug} onChange={() => setPlan(p.slug)} className="sr-only" />
            <span className="text-lg font-semibold tracking-[-0.02em]">{p.name}</span>
            <span className="money mt-1 text-[1.6rem] font-bold tracking-[-0.04em]">{cycle === "monthly" ? p.monthly : p.yearly}<span className="text-sm font-normal text-ink-soft">{cycle === "monthly" ? "/mês" : "/ano"}</span></span>
            {cycle === "yearly" && p.yearlySavings && <span className="text-xs font-semibold text-gain">{p.yearlySavings}</span>}
            <ul className="mt-3 grid gap-1 text-sm text-ink-soft">
              {p.features.slice(0, 4).map((f) => (
                <li key={f} className="flex gap-1.5"><span aria-hidden="true" className="text-gain">✓</span>{f}</li>
              ))}
            </ul>
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">2. Forma de pagamento</legend>
        <label className={`cursor-pointer rounded-[24px] bg-surface p-5 transition-shadow ${method === "credit_card" ? "shadow-[inset_0_0_0_2px_var(--color-gain)]" : "shadow-[inset_0_0_0_1px_var(--hair-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-gain)]"}`}>
          <input type="radio" name="method" value="credit_card" checked={method === "credit_card"} onChange={() => setMethod("credit_card")} className="sr-only" />
          <span className="block font-semibold">💳 Cartão de crédito</span>
          <span className="mt-1 block text-sm text-ink-soft">
            {trialUntil
              ? `Use grátis até ${trialUntil}. A primeira cobrança só acontece nesse dia e depois ${cycle === "monthly" ? "todo mês" : "todo ano"}. Cancele antes e não paga nada.`
              : `Cobrança automática ${cycle === "monthly" ? "todo mês" : "todo ano"} no mesmo cartão. Acesso liberado assim que o cartão é aprovado.`}
          </span>
          {trialUntil && <span className="mt-2 inline-block rounded-full bg-gain-soft px-2.5 py-0.5 text-xs font-semibold text-gain">Teste grátis</span>}
        </label>
        <label className={`cursor-pointer rounded-[24px] bg-surface p-5 transition-shadow ${method === "pix" ? "shadow-[inset_0_0_0_2px_var(--color-gain)]" : "shadow-[inset_0_0_0_1px_var(--hair-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-gain)]"}`}>
          <input type="radio" name="method" value="pix" checked={method === "pix"} onChange={() => setMethod("pix")} className="sr-only" />
          <span className="block font-semibold">⚡ Pix</span>
          <span className="mt-1 block text-sm text-ink-soft">
            {trialUntil && inTrial
              ? `Seu teste vai até ${pixTrialUntil ?? trialUntil}. O Pix chega no seu e-mail para pagar no fim do teste e o acesso continua sem interrupção.`
              : trialUntil
              ? `Use grátis até ${pixTrialUntil ?? trialUntil}, sem pagar nada agora e sem precisar de CPF. No fim do teste é só pagar pelo Pix para continuar; se não pagar, o acesso pausa no dia seguinte.`
              : `Você paga pelo QR Code. A cada ${cycle === "monthly" ? "mês" : "ano"} chega uma nova cobrança Pix no seu e-mail.`}
          </span>
          {trialUntil && !inTrial && <span className="mt-2 inline-block rounded-full bg-gain-soft px-2.5 py-0.5 text-xs font-semibold text-gain">Teste grátis</span>}
        </label>
      </fieldset>

      {!(method === "pix" && trialUntil && !inTrial) && <div className="grid gap-4 sm:grid-cols-[minmax(0,280px)_1fr] sm:items-end">
        <label className="field">
          <span>CPF ou CNPJ do pagador</span>
          <input className="input money" name="cpfCnpj" inputMode="numeric" autoComplete="off" value={doc} onChange={(e) => setDoc(cpfMask(e.target.value))} placeholder="000.000.000-00" required />
        </label>
        <p className="text-xs text-ink-faint">🔒 Por que pedimos? Toda cobrança no Brasil precisa do CPF de quem paga (regra do Banco Central). Ele vai direto para o Asaas, a instituição que processa o pagamento, e não fica salvo no FinanceZap.</p>
      </div>}

      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
        <Submit className="btn btn-primary text-base" pendingText="Abrindo pagamento…">
          {method === "pix" ? trialUntil && !inTrial ? "Começar teste grátis" : `Gerar Pix${selected ? ` · ${cycle === "monthly" ? selected.monthly : selected.yearly}` : ""}` : trialUntil ? "Cadastrar cartão e começar grátis" : `Pagar com cartão${selected ? ` · ${cycle === "monthly" ? selected.monthly : selected.yearly}` : ""}`}
        </Submit>
        <p className="text-sm text-ink-soft">{method === "pix" && trialUntil && !inTrial ? "O teste começa na hora, sem pagar nada agora." : "Você vai para a página segura do Asaas. Dados do cartão não passam pelo FinanceZap."}</p>
      </div>
    </ActionForm>
  );
}
