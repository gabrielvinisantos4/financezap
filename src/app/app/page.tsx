import Link from "next/link";
import { withUser } from "@/server/db/client";
import { availability, dailyExpenses, listTransactions, payables, periodSummary, totalsByCategory } from "@/server/finance/queries";
import { budgetStatuses } from "@/server/finance/budgets";
import { listAccounts, listCategories } from "@/server/finance/engine";
import { addDays, addMonths, daysInMonth, endOfMonth, formatBR, monthLabel, monthName, resolvePeriod, startOfMonth } from "@/server/finance/dates";
import { appContext } from "@/server/app-context";
import { Empty, Money, Panel } from "@/components/ui";
import { EntryForm } from "@/components/entry-form";
import { SpendingBreakdown } from "@/components/spending-breakdown";
import { SpendingPace, type PacePoint } from "@/components/spending-pace";
import { BudgetBar } from "@/components/budget-bar";
import { formatBRL } from "@/server/finance/money";

export const metadata = { title: "Visão geral" };

export default async function Overview() {
  const { user, today } = await appContext();
  const month = resolvePeriod({ type: "this_month" }, today);
  // Mês anterior: inteiro para o gráfico de ritmo; até o mesmo dia para comparar categorias
  const prevStart = startOfMonth(addMonths(today, -1));
  const prevEnd = endOfMonth(prevStart);
  const dayOfMonth = Number(today.slice(8, 10));
  const prevSameDay = `${prevStart.slice(0, 8)}${String(Math.min(dayOfMonth, Number(prevEnd.slice(8, 10)))).padStart(2, "0")}`;
  const data = await withUser(user.id, async (tx) => ({
    avail: await availability(tx, user.id, today),
    summary: await periodSummary(tx, user.id, month),
    cats: await totalsByCategory(tx, user.id, month, "expense"),
    prevCats: await totalsByCategory(tx, user.id, { from: prevStart, to: prevSameDay, label: "" }, "expense"),
    dailyNow: await dailyExpenses(tx, user.id, { from: month.from, to: today, label: "" }),
    dailyPrev: await dailyExpenses(tx, user.id, { from: prevStart, to: prevEnd, label: "" }),
    budgets: await budgetStatuses(tx, user.id, today),
    recent: await listTransactions(tx, user.id, { limit: 8 }),
    due: await payables(tx, user.id, addDays(today, 15)),
    categories: await listCategories(tx, user.id),
    accounts: await listAccounts(tx, user.id),
  }));
  const committed = data.avail.cardDebtCents + data.avail.payablesCents + data.avail.futureCardInstallmentsCents;
  const prevName = monthName(Number(prevStart.slice(5, 7)));
  const breakdown = data.cats
    .filter((c) => c.totalCents > 0)
    .map((c) => ({ key: c.categoryId ?? "none", name: c.name, icon: c.icon, cents: c.totalCents, prevCents: data.prevCats.find((p) => p.categoryId === c.categoryId)?.totalCents ?? 0 }));
  const spentNow = breakdown.reduce((s, r) => s + r.cents, 0);
  const spentPrevSameDay = data.prevCats.reduce((s, r) => s + Math.max(0, r.totalCents), 0);
  const paceDelta = spentPrevSameDay > 0 ? Math.round(((spentNow - spentPrevSameDay) / spentPrevSameDay) * 100) : null;

  // Acumulado por dia (1..último dia do mês atual ou anterior)
  const daysNow = daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const daysPrev = Number(prevEnd.slice(8, 10));
  const accumulate = (rows: { date: string; cents: number }[]) => {
    const byDay = new Map(rows.map((r) => [Number(r.date.slice(8, 10)), r.cents]));
    let acc = 0;
    return (day: number) => (acc += byDay.get(day) ?? 0);
  };
  const nowAt = accumulate(data.dailyNow);
  const prevAt = accumulate(data.dailyPrev);
  const pace: PacePoint[] = Array.from({ length: Math.max(daysNow, daysPrev) }, (_, i) => {
    const day = i + 1;
    return { day, current: day <= dayOfMonth ? nowAt(day) : null, previous: day <= daysPrev ? prevAt(day) : null };
  });
  const monthLimit = data.budgets.find((b) => b.categoryId === null)?.limitCents ?? null;

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
            {breakdown.length === 0 ? (
              <Empty title="Nenhuma despesa neste mês">Mande “gastei 50 no mercado” no WhatsApp ou adicione ao lado.</Empty>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="money text-3xl font-semibold tracking-tight">{formatBRL(spentNow)}</p>
                  <p className="text-sm text-ink-soft">
                    {paceDelta === null ? (
                      `em ${breakdown.length} ${breakdown.length === 1 ? "categoria" : "categorias"}`
                    ) : (
                      <>
                        <span className={paceDelta > 0 ? "font-semibold text-loss" : "font-semibold text-gain"}>
                          {paceDelta > 0 ? "▲" : "▼"} {Math.abs(paceDelta)}%
                        </span>{" "}
                        vs mesmo período de {prevName}
                      </>
                    )}
                  </p>
                </div>
                <SpendingBreakdown rows={breakdown} prevLabel={prevName} />
              </>
            )}
          </Panel>

          <Panel title="Ritmo de gastos">
            {data.dailyNow.length === 0 && data.dailyPrev.length === 0 ? (
              <p className="text-sm text-ink-soft">O gráfico aparece quando houver despesas registradas.</p>
            ) : (
              <SpendingPace data={pace} currentLabel={monthLabel(today)} previousLabel={monthLabel(prevStart)} limitCents={monthLimit} />
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
          <Panel title="Limites do mês" action={<Link href="/app/limites" className="text-sm font-semibold">{data.budgets.length ? "Gerenciar" : "Criar"}</Link>}>
            {data.budgets.length === 0 ? (
              <p className="text-sm text-ink-soft">Defina quanto quer gastar por categoria e receba um aviso no WhatsApp ao chegar em 80%. Ex.: “limite de 800 para mercado”.</p>
            ) : (
              <ul className="grid gap-4">
                {data.budgets.slice(0, 6).map((b) => (
                  <li key={b.id} className="grid gap-1.5">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{b.icon} {b.name}</span>
                      <span className="money shrink-0 tabular-nums">
                        {formatBRL(b.spentCents)} <span className="text-ink-faint">/ {formatBRL(b.limitCents)}</span>
                      </span>
                    </div>
                    <BudgetBar pct={b.pct} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
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
