"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./forms";
import { createAccountAction } from "@/app/actions/app";

const TYPES = [
  ["checking", "Conta corrente"],
  ["savings", "Poupança"],
  ["cash", "Dinheiro"],
  ["wallet", "Carteira digital"],
  ["investment", "Investimentos"],
  ["credit_card", "Cartão de crédito"],
] as const;

export function AccountForm() {
  const [type, setType] = useState("checking");
  const card = type === "credit_card";
  return (
    <ActionForm action={createAccountAction} resetOnSuccess>
      <label className="field">
        <span>Nome</span>
        <input className="input" name="name" placeholder={card ? "Ex.: Nubank" : "Ex.: Banco do Brasil"} required />
      </label>
      <label className="field">
        <span>Tipo</span>
        <select className="input" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </label>
      {card ? (
        <>
          <label className="field">
            <span>Limite (R$, opcional)</span>
            <input className="input money" name="limit" inputMode="decimal" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="field">
              <span>Dia do fechamento</span>
              <input className="input" name="closingDay" type="number" min={1} max={31} required />
            </label>
            <label className="field">
              <span>Dia do vencimento</span>
              <input className="input" name="dueDay" type="number" min={1} max={31} required />
            </label>
          </div>
        </>
      ) : (
        <label className="field">
          <span>Saldo atual (R$)</span>
          <input className="input money" name="initial" inputMode="decimal" placeholder="0,00" />
          <small className="text-ink-faint">O saldo de hoje no banco. A partir daqui, o FinanceZap soma o que você registrar.</small>
        </label>
      )}
      <Submit>Criar conta</Submit>
    </ActionForm>
  );
}
