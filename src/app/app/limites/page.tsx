import Link from "next/link";
import { withUser } from "@/server/db/client";
import { CategoryIcon } from "@/components/category-icon";
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

/** Valor em centavos no formato que a pessoa digita no campo (ex.: 80000 → "800,00"). */
const toInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export default async function Limits({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const sp = await searchParams;
  const { user } = await appContext();
  const today = todayIn(user.timezone);
  const { list, cats } = await withUser(user.id, async (tx) => ({
    list: await budgetStatuses(tx, user.id, today),
    cats: (await listCategories(tx, user.id, "expense")).filter((c) => !c.archivedAt),
  }));
  // Limite aberto para edição: o formulário ao lado já vem com a categoria e o valor atual
  const editing = list.find((b) => b.id === sp.editar) ?? null;

  return (
    <>
      <PageHeader title="Limites de gasto" description={`Quanto você quer gastar por mês. Avisamos pelo WhatsApp ao chegar em 80% e em 100%. Valores de ${monthLabel(today)}.`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel title="Seus limites">
          {list.length ? (
            <ul className="grid gap-5">
              {list.map((b) => (
                <li key={b.id} className={`grid gap-2 ${editing?.id === b.id ? "-mx-3 rounded-[16px] bg-gain-soft/60 px-3 py-2.5" : ""}`}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                    <span className="font-semibold">
                      <CategoryIcon icon={b.icon} size={16} className="mr-1.5 text-ink-faint" />
                      {b.name}
                    </span>
                    <span className="flex items-center justify-between gap-2 text-sm sm:justify-end">
                      <span className="money mr-auto sm:mr-0">
                        {formatBRL(b.spentCents)} <span className="text-ink-faint">de {formatBRL(b.limitCents)}</span>
                      </span>
                      <Link
                        href={`/app/limites?editar=${b.id}#limite-form`}
                        className={`-my-1 inline-flex h-8 items-center rounded-full px-2.5 font-semibold transition-colors hover:bg-gain-soft hover:text-gain ${editing?.id === b.id ? "bg-gain-soft text-gain" : "text-ink-soft"}`}
                        aria-label={`Editar limite de ${b.name}`}
                      >
                        Editar
                      </Link>
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

        <div id="limite-form" className="scroll-mt-24">
          <Panel
            title={editing ? `Editar limite de ${editing.name}` : "Novo limite ou alterar"}
            action={editing ? <Link href="/app/limites" scroll={false} className="text-sm font-semibold text-ink-soft hover:text-ink">Cancelar</Link> : undefined}
          >
            <ActionForm key={editing?.id ?? "novo"} action={saveBudgetAction} resetOnSuccess={!editing}>
              <label className="field">
                <span>Categoria</span>
                {editing ? (
                  <>
                    {/* Na edição a categoria fica fixa; só o valor muda */}
                    <input type="hidden" name="category" value={editing.slug ?? ""} />
                    <select className="input opacity-70" defaultValue={editing.slug ?? ""} disabled>
                      <option value={editing.slug ?? ""}>{editing.categoryId ? editing.name : "Total do mês (todas as despesas)"}</option>
                    </select>
                  </>
                ) : (
                  <select className="input" name="category" defaultValue="">
                    <option value="">Total do mês (todas as despesas)</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label className="field">
                <span>Limite por mês (R$)</span>
                <input className="input money" name="amount" inputMode="decimal" placeholder="800,00" defaultValue={editing ? toInput(editing.limitCents) : undefined} autoFocus={Boolean(editing)} required />
              </label>
              <Submit>{editing ? "Salvar novo valor" : "Salvar limite"}</Submit>
              <p className="text-xs text-ink-faint">{editing ? "O gasto do mês continua contando normalmente; só o limite muda." : "Se já existir limite para a categoria, o valor é atualizado."}</p>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
