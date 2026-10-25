import { withUser } from "@/server/db/client";
import { listAccounts, listCategories } from "@/server/finance/engine";
import { listRecurring } from "@/server/finance/queries";
import { formatBRL } from "@/server/finance/money";
import { formatBR } from "@/server/finance/dates";
import { appContext } from "@/server/app-context";
import { getEntitlement } from "@/server/billing/entitlements";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, ConfirmButton, Submit } from "@/components/forms";
import { archiveCategoryAction, createCategoryAction, createRecurringAction } from "@/app/actions/app";

export const metadata = { title: "Categorias e recorrências" };

export default async function Categories() {
  const { user } = await appContext();
  const [data, ent] = await Promise.all([
    withUser(user.id, async (tx) => ({ cats: await listCategories(tx, user.id), recurring: await listRecurring(tx, user.id), accounts: await listAccounts(tx, user.id) })),
    getEntitlement(user.id),
  ]);
  const canCustom = ent.active && ent.limits.customCategories;

  return (
    <>
      <PageHeader title="Categorias e recorrências" description="O assistente usa estas categorias para classificar o que você manda no WhatsApp." />
      <div className="grid gap-6 lg:grid-cols-2">
        {(["expense", "income"] as const).map((kind) => (
          <Panel key={kind} title={kind === "expense" ? "Despesas" : "Receitas"}>
            <ul className="flex flex-wrap gap-2">
              {data.cats
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <li key={c.id} className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm">
                    {c.icon} {c.name}
                    {!c.isSystem && (
                      <form action={archiveCategoryAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <ConfirmButton message={`Remover a categoria ${c.name}?`} className="text-ink-faint hover:text-loss">
                          <span aria-label={`Remover ${c.name}`}>×</span>
                        </ConfirmButton>
                      </form>
                    )}
                  </li>
                ))}
            </ul>
          </Panel>
        ))}

        <Panel title="Nova categoria">
          {canCustom ? (
            <ActionForm action={createCategoryAction} resetOnSuccess>
              <div className="grid grid-cols-[80px_1fr] gap-3">
                <label className="field">
                  <span>Ícone</span>
                  <input className="input text-center" name="icon" maxLength={4} placeholder="🐶" />
                </label>
                <label className="field">
                  <span>Nome</span>
                  <input className="input" name="name" placeholder="Ex.: Pet" required />
                </label>
              </div>
              <label className="field">
                <span>Tipo</span>
                <select className="input" name="kind">
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </label>
              <Submit>Criar categoria</Submit>
            </ActionForm>
          ) : (
            <p className="text-sm text-ink-soft">Categorias personalizadas estão disponíveis a partir do plano Pro.</p>
          )}
        </Panel>

        <Panel title="Contas fixas (recorrentes)">
          {data.recurring.length > 0 && (
            <ul className="mb-4 divide-y divide-line text-sm">
              {data.recurring.map((r) => (
                <li key={r.id} className="flex justify-between py-2">
                  <span>Dia {r.dayOfMonth} · {r.description}</span>
                  <span className="money">{formatBRL(r.amountCents)} <span className="text-ink-faint">· próxima {formatBR(r.nextDueOn)}</span></span>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={createRecurringAction} resetOnSuccess>
            <div className="grid grid-cols-2 gap-3">
              <label className="field">
                <span>Descrição</span>
                <input className="input" name="description" placeholder="Ex.: Internet" required />
              </label>
              <label className="field">
                <span>Valor (R$)</span>
                <input className="input money" name="amount" inputMode="decimal" required />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="field">
                <span>Tipo</span>
                <select className="input" name="kind">
                  <option value="expense">Despesa</option>
                  <option value="income">Receita</option>
                </select>
              </label>
              <label className="field">
                <span>Dia</span>
                <input className="input" type="number" name="day" min={1} max={31} required />
              </label>
              <label className="field">
                <span>Conta</span>
                <select className="input" name="accountId">
                  {data.accounts.filter((a) => a.type !== "credit_card").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Categoria</span>
              <select className="input" name="categoryId">
                <option value="">Sem categoria</option>
                {data.cats.map((c) => <option key={c.id} value={c.id}>{c.kind === "expense" ? "Despesa" : "Receita"} · {c.name}</option>)}
              </select>
            </label>
            <Submit>Adicionar recorrência</Submit>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
