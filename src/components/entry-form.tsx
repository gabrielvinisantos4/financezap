"use client";

import { useState } from "react";
import { ActionForm, Submit } from "./forms";
import { saveEntryAction } from "@/app/actions/app";

type Opt = { id: string; name: string; kind?: string; icon?: string; type?: string };

export type EntryDefaults = {
  id?: string;
  version?: number;
  kind?: "income" | "expense";
  amount?: string;
  description?: string;
  party?: string | null;
  categoryId?: string | null;
  accountId?: string;
  occurredOn: string;
  pending?: boolean;
  notes?: string | null;
  paymentMethod?: string | null;
};

const METHODS = [
  ["", "Não informar"],
  ["pix", "Pix"],
  ["credito", "Cartão de crédito"],
  ["debito", "Cartão de débito"],
  ["dinheiro", "Dinheiro"],
  ["boleto", "Boleto"],
  ["transferencia", "Transferência"],
] as const;

export function EntryForm({ categories, accounts, defaults }: { categories: Opt[]; accounts: Opt[]; defaults: EntryDefaults }) {
  const [kind, setKind] = useState<"income" | "expense">(defaults.kind ?? "expense");
  const editing = Boolean(defaults.id);
  return (
    <ActionForm action={saveEntryAction} resetOnSuccess={!editing} className="grid gap-3">
      {editing && (
        <>
          <input type="hidden" name="id" value={defaults.id} />
          <input type="hidden" name="version" value={defaults.version} />
        </>
      )}
      <fieldset className="grid grid-cols-2 gap-1 rounded-full bg-paper p-1" aria-label="Tipo">
        {(["expense", "income"] as const).map((k) => (
          <label key={k} className={`cursor-pointer rounded-full py-2 text-center text-sm font-semibold ${kind === k ? (k === "expense" ? "lg-btn text-loss" : "lg-btn text-gain") : "text-ink-soft"}`}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {k === "expense" ? "Despesa" : "Receita"}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="field">
          <span>Valor (R$)</span>
          <input className="input money" name="amount" inputMode="decimal" placeholder="0,00" defaultValue={defaults.amount} required />
        </label>
        <label className="field">
          <span>Data</span>
          <input className="input" type="date" name="occurredOn" defaultValue={defaults.occurredOn} required />
        </label>
      </div>
      <label className="field">
        <span>Descrição</span>
        <input className="input" name="description" defaultValue={defaults.description} placeholder={kind === "expense" ? "Ex.: Mercado do mês" : "Ex.: Edição de vídeo"} required />
      </label>
      <label className="field">
        <span>{kind === "expense" ? "Estabelecimento" : "Cliente ou pagador"}</span>
        <input className="input" name="party" defaultValue={defaults.party ?? ""} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="field">
          <span>Categoria</span>
          <select className="input" name="categoryId" defaultValue={defaults.categoryId ?? ""} key={kind}>
            <option value="">Automática</option>
            {categories
              .filter((c) => c.kind === kind)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>Conta ou cartão</span>
          <select className="input" name="accountId" defaultValue={defaults.accountId ?? ""}>
            {!editing && <option value="">Conta principal</option>}
            {accounts
              .filter((a) => kind === "expense" || a.type !== "credit_card")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Forma de pagamento</span>
        <select className="input" name="paymentMethod" defaultValue={defaults.paymentMethod ?? ""}>
          {METHODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      {!editing && (
        <label className="field">
          <span>Parcelas</span>
          <select className="input" name="installments" defaultValue="1">
            {[1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "À vista" : `${n}x`}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="pending" defaultChecked={defaults.pending} className="h-4 w-4 accent-[#16a34a]" />
        {kind === "expense" ? "Ainda não paguei (conta a pagar com vencimento na data acima)" : "Ainda não recebi (conta a receber)"}
      </label>
      <label className="field">
        <span>Observações</span>
        <textarea className="input" name="notes" rows={2} defaultValue={defaults.notes ?? ""} />
      </label>
      <Submit>{editing ? "Salvar alterações" : "Adicionar lançamento"}</Submit>
    </ActionForm>
  );
}
