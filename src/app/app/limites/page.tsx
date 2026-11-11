import { withUser } from "@/server/db/client";
import { listCategories } from "@/server/finance/engine";
import { budgetStatuses } from "@/server/finance/budgets";
import { formatBRL } from "@/server/finance/money";
import { monthLabel, todayIn } from "@/server/finance/dates";
import { appContext } from "@/server/app-context";
import { Empty, PageHeader, Panel } from "@/components/ui";
import { ActionForm, ConfirmButton, Submit } from "@/components/forms";
import { BudgetBar } from "@/components/budget-bar";
import { removeBudgetAction, saveBudgetAction } from "@/app/actions/app";

export const metadata = { title: "Limites de gasto" };

export default async function Limits() {
  const { user } = await appContext();
  const today = todayIn(user.timezone);
  const { list, cats } = await withUser(user.id, async (tx) => ({
    list: await budgetStatuses(tx, user.id, today),
    cats: (await listCategories(tx, user.id, "expense")).filter((c) => !c.archivedAt),
  }));

  return (
    <>
      <PageHeader title="Limites de gasto" description={`Quanto você quer gastar por mês. Avisamos pelo WhatsApp ao chegar em 80% e em 100%. Valores de ${monthLabel(today)}.`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel title="Seus limites">
          {list.length ? (
            <ul className="grid gap-5">
              {list.map((b) => (
                <li key={b.id} className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">
                      {b.icon} {b.name}
                    </span>
                    <span className="flex items-center gap-3 text-sm">
                      <span className="money">
                        {formatBRL(b.spentCents)} <span className="text-ink-faint">de {formatBRL(b.limitCents)}</span>
                      </span>
                      <form action={removeBudgetAction}>
                        <input type="hidden" name="id" value={b.id} />
                        <ConfirmButton message={`Remover o limite de ${b.name}?`} className="text-ink-faint hover:text-loss">
                          <span aria-label={`Remover limite de ${b.name}`}>×</span>
                        </ConfirmButton>
                      </form>
                    </span>
                  </div>
                  <BudgetBar pct={b.pct} />
                  <p className="text-xs text-ink-soft">
                    {b.spentCents <= b.limitCents ? `Restam ${formatBRL(b.limitCents - b.spentCents)} · ${b.pct}% usado` : `${formatBRL(b.spentCents - b.limitCents)} acima do limite`}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nenhum limite ainda">Crie aqui ao lado ou mande no WhatsApp: “limite de 800 para mercado”.</Empty>
          )}
        </Panel>

        <Panel title="Novo limite ou alterar">
          <ActionForm action={saveBudgetAction} resetOnSuccess>
            <label className="field">
              <span>Categoria</span>
              <select className="input" name="category" defaultValue="">
                <option value="">Total do mês (todas as despesas)</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Limite por mês (R$)</span>
              <input className="input money" name="amount" inputMode="decimal" placeholder="800,00" required />
            </label>
            <Submit>Salvar limite</Submit>
            <p className="text-xs text-ink-faint">Se já existir limite para a categoria, o valor é atualizado.</p>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
