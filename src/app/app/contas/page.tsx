import { withUser } from "@/server/db/client";
import { availability } from "@/server/finance/queries";
import { listAccounts } from "@/server/finance/engine";
import { appContext } from "@/server/app-context";
import { Money, PageHeader, Panel } from "@/components/ui";
import { AccountForm } from "@/components/account-form";
import { ActionForm, ConfirmButton, Submit } from "@/components/forms";
import { archiveAccountAction, transferAction } from "@/app/actions/app";

export const metadata = { title: "Contas e cartões" };

const LABEL: Record<string, string> = { checking: "Conta corrente", savings: "Poupança", cash: "Dinheiro", wallet: "Carteira digital", investment: "Investimentos", credit_card: "Cartão de crédito" };

export default async function Accounts() {
  const { user, today } = await appContext();
  const { avail, accounts } = await withUser(user.id, async (tx) => ({ avail: await availability(tx, user.id, today), accounts: await listAccounts(tx, user.id) }));
  const meta = new Map(accounts.map((a) => [a.id, a]));
  const banks = avail.accounts.filter((a) => a.type !== "credit_card");
  const cards = avail.accounts.filter((a) => a.type === "credit_card");

  return (
    <>
      <PageHeader title="Contas e cartões" description="Saldos calculados a partir do saldo inicial e dos lançamentos registrados. Não há conexão com o seu banco." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-6">
          <Panel title="Contas">
            <ul className="divide-y divide-line">
              {banks.map((a) => (
                <li key={a.accountId} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{a.name} {meta.get(a.accountId)?.isDefault && <span className="text-xs text-ink-faint">· principal</span>}</p>
                    <p className="text-xs text-ink-faint">{LABEL[a.type]}{a.futureCents ? <> · <Money cents={a.futureCents} /> agendado</> : null}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Money cents={a.balanceCents} className="wide text-lg" />
                    {!meta.get(a.accountId)?.isDefault && (
                      <form action={archiveAccountAction}>
                        <input type="hidden" name="id" value={a.accountId} />
                        <ConfirmButton message="Arquivar esta conta? Os lançamentos continuam no histórico.">Arquivar</ConfirmButton>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between border-t border-line pt-3 font-semibold">
              Total disponível <Money cents={avail.availableCents} />
            </p>
          </Panel>
          <Panel title="Cartões de crédito">
            {cards.length === 0 ? (
              <p className="text-sm text-ink-soft">Cadastre um cartão para registrar compras no crédito e parcelamentos sem duplicar despesas.</p>
            ) : (
              <ul className="divide-y divide-line">
                {cards.map((c) => {
                  const m = meta.get(c.accountId);
                  const used = Math.max(0, -c.balanceCents) + Math.max(0, -c.futureCents);
                  return (
                    <li key={c.accountId} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-ink-faint">Fecha dia {m?.closingDay} · vence dia {m?.dueDay}</p>
                        </div>
                        <form action={archiveAccountAction}>
                          <input type="hidden" name="id" value={c.accountId} />
                          <ConfirmButton message="Arquivar este cartão?">Arquivar</ConfirmButton>
                        </form>
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                        <div><dt className="text-ink-faint">Em aberto</dt><dd><Money cents={Math.max(0, -c.balanceCents)} /></dd></div>
                        <div><dt className="text-ink-faint">Parcelas futuras</dt><dd><Money cents={Math.max(0, -c.futureCents)} /></dd></div>
                        <div><dt className="text-ink-faint">Limite livre</dt><dd>{c.creditLimitCents ? <Money cents={c.creditLimitCents - used} /> : "—"}</dd></div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
        <div className="grid content-start gap-6">
          <Panel title="Transferir ou pagar fatura">
            <p className="mb-3 text-sm text-ink-soft">Movimentar entre suas contas não conta como receita nem despesa. Para pagar a fatura, escolha o cartão como destino.</p>
            <ActionForm action={transferAction} resetOnSuccess>
              <div className="grid grid-cols-2 gap-3">
                <label className="field">
                  <span>De</span>
                  <select className="input" name="from" required>
                    {banks.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Para</span>
                  <select className="input" name="to" required>
                    {avail.accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="field">
                  <span>Valor (R$)</span>
                  <input className="input money" name="amount" inputMode="decimal" required />
                </label>
                <label className="field">
                  <span>Data</span>
                  <input className="input" type="date" name="occurredOn" defaultValue={today} />
                </label>
              </div>
              <Submit>Registrar movimentação</Submit>
            </ActionForm>
          </Panel>
          <Panel title="Nova conta ou cartão">
            <AccountForm />
          </Panel>
        </div>
      </div>
    </>
  );
}
