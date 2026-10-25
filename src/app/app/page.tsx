import Link from "next/link";
import { withUser } from "@/server/db/client";
import { availability, listTransactions, payables, periodSummary, totalsByCategory } from "@/server/finance/queries";
import { listAccounts, listCategories } from "@/server/finance/engine";
import { addDays, formatBR, monthLabel, resolvePeriod } from "@/server/finance/dates";
import { appContext } from "@/server/app-context";
import { Empty, Money, Panel } from "@/components/ui";
import { EntryForm } from "@/components/entry-form";

export const metadata = { title: "Visão geral" };

export default async function Overview() {
  const { user, today } = await appContext();
  const month = resolvePeriod({ type: "this_month" }, today);
  const data = await withUser(user.id, async (tx) => ({
    avail: await availability(tx, user.id, today),
    summary: await periodSummary(tx, user.id, month),
    cats: await totalsByCategory(tx, user.id, month, "expense"),
    recent: await listTransactions(tx, user.id, { limit: 8 }),
    due: await payables(tx, user.id, addDays(today, 15)),
    categories: await listCategories(tx, user.id),
    accounts: await listAccounts(tx, user.id),
  }));
  const committed = data.avail.cardDebtCents + data.avail.payablesCents + data.avail.futureCardInstallmentsCents;
  const maxCat = Math.max(1, ...data.cats.map((c) => c.totalCents));

  return (
    <div className="grid gap-6">
      <section aria-labelledby="disp" className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-3xl bg-ink p-6 text-white sm:p-8">
          <h1 id="disp" className="text-white/70">Disponível nas suas contas</h1>
          <p className="display money mt-2 whitespace-nowrap text-[2.4rem] text-coin sm:text-6xl">
            <Money cents={data.avail.availableCents} />
          </p>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-white/60">Comprometido</dt>
              <dd className="money mt-0.5 text-lg"><Money cents={committed} /></dd>
            </div>
            <div>
              <dt className="text-white/60">A receber</dt>
              <dd className="money mt-0.5 text-lg"><Money cents={data.avail.receivablesCents} /></dd>
            </div>
            <div>
              <dt className="text-white/60">Projeção</dt>
              <dd className="money mt-0.5 text-lg"><Money cents={data.avail.projectedCents} /></dd>
            </div>
          </dl>
        </div>
        <Panel title={`Resultado de ${monthLabel(today)}`}>
          <dl className="grid gap-3">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Entradas</dt>
              <dd className="money text-xl text-gain"><Money cents={data.summary.incomeCents} /></dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Saídas</dt>
              <dd className="money text-xl text-loss"><Money cents={data.summary.netExpenseCents} /></dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="font-semibold">Resultado</dt>
              <dd className="wide money text-2xl"><Money cents={data.summary.resultCents} sign /></dd>
            </div>
          </dl>
          <Link href="/app/relatorios" className="mt-4 inline-block text-sm font-semibold underline-offset-2 hover:underline">Ver relatório do mês</Link>
        </Panel>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="grid gap-6">
          <Panel title="Onde foi o dinheiro neste mês">
            {data.cats.length === 0 ? (
              <Empty title="Nenhuma despesa neste mês">Mande “gastei 50 no mercado” no WhatsApp ou adicione ao lado.</Empty>
            ) : (
              <ul className="grid gap-3">
                {data.cats.slice(0, 8).map((c) => (
                  <li key={c.categoryId ?? "none"}>
                    <div className="flex justify-between text-sm">
                      <span>{c.icon} {c.name}</span>
                      <Money cents={c.totalCents} className="font-semibold" />
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-paper" aria-hidden="true">
                      <div className="h-2 rounded-full bg-ink" style={{ width: `${Math.max(2, (c.totalCents / maxCat) * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Últimos lançamentos" action={<Link href="/app/lancamentos" className="text-sm font-semibold">Ver todos</Link>}>
            {data.recent.length === 0 ? (
              <Empty title="Nada por aqui ainda">Seus registros pelo WhatsApp aparecem aqui na hora.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{t.categoryIcon} {t.description}</p>
                      <p className="text-xs text-ink-faint">{formatBR(t.occurredOn)} · {t.accountName}{t.status === "pending" ? " · a pagar" : ""}</p>
                    </div>
                    <Money cents={t.kind === "income" || t.kind === "refund" ? t.amountCents : t.kind === "expense" ? -t.amountCents : 0} sign className="shrink-0 font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Vencendo nos próximos 15 dias">
            {data.due.length === 0 ? (
              <p className="text-sm text-ink-soft">Nenhuma conta a pagar no período.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {data.due.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className={t.dueOn && t.dueOn < today ? "text-loss" : ""}>{t.dueOn ? formatBR(t.dueOn).slice(0, 5) : ""} · {t.description}</span>
                    <Money cents={t.amountCents} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Adicionar pelo painel">
            <EntryForm
              categories={data.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, icon: c.icon }))}
              accounts={data.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
              defaults={{ occurredOn: today }}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
