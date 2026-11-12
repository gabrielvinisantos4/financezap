import Link from "next/link";
import { withUser } from "@/server/db/client";
import { availability, dailyExpenses, listTransactions, payables, periodSummary, totalsByCategory, totalsByPaymentMethod } from "@/server/finance/queries";
import { isPaymentMethod, PAYMENT_METHOD_ICONS, PAYMENT_METHOD_LABELS } from "@/server/finance/payment-methods";
import { budgetStatuses } from "@/server/finance/budgets";
import { listAccounts, listCategories } from "@/server/finance/engine";
import { addDays, addMonths, daysInMonth, endOfMonth, formatBR, monthLabel, monthName, resolvePeriod, startOfMonth } from "@/server/finance/dates";
import { appContext } from "@/server/app-context";
import { getLinkedNumber } from "@/server/whatsapp/linking";
import { env } from "@/server/config/env";
import { LinkWhatsapp } from "@/components/link-whatsapp";
import { Icon } from "@/components/icons";
import { Empty, Money, Panel, PanelLink, Stat } from "@/components/ui";
import { Ring } from "@/components/ring";
import { EntryForm } from "@/components/entry-form";
import { SpendingBreakdown } from "@/components/spending-breakdown";
import { SpendingPace, type PacePoint } from "@/components/spending-pace";
import { formatBRL } from "@/server/finance/money";

export const metadata = { title: "Visão geral" };

export default async function Overview() {
  const { user, today } = await appContext();
  const linked = await getLinkedNumber(user.id);
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
    methods: await totalsByPaymentMethod(tx, user.id, month, "expense"),
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

  const firstName = user.name.trim().split(/\s+/)[0] ?? "";
  const hour = Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const savings = data.summary.incomeCents > 0 ? Math.round((data.summary.resultCents / data.summary.incomeCents) * 100) : null;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-[-0.035em] sm:text-[2.1rem]">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-ink-soft">Veja como estão suas finanças este mês.</p>
        </div>
        <span className="card inline-flex h-10 items-center rounded-full px-4 text-sm font-semibold capitalize">{monthLabel(today)}</span>
      </header>

      {!linked && (
        <section aria-labelledby="vincular-t" className="card relative overflow-hidden p-5 sm:p-7" style={{ boxShadow: "inset 0 0 0 1.5px var(--color-gain), var(--shadow-md)" }}>
          <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-gain opacity-[0.12] blur-3xl" aria-hidden="true" />
          <div className="relative grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-6">
            <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-gain-soft text-gain">
              <Icon name="chat" size={26} />
            </span>
            <div className="grid gap-4">
              <div>
                <h2 id="vincular-t" className="text-[1.35rem] font-bold tracking-[-0.03em]">
                  Conecte seu WhatsApp
                </h2>
                <p className="mt-1 max-w-xl text-ink-soft">
                  É só tocar no botão, abrir o WhatsApp e enviar a mensagem que já vem pronta. Em segundos o FinanceZap confirma e você já pode mandar seus gastos.
                </p>
              </div>
              <LinkWhatsapp hasBusinessNumber={Boolean(env().WHATSAPP_BUSINESS_NUMBER)} />
            </div>
          </div>
        </section>
      )}

      <section aria-label="Resumo do mês" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat icon="wallet" label="Disponível">
          <Money cents={data.avail.availableCents} />
        </Stat>
        <Stat icon="up" label="Entradas" tone="gain">
          <Money cents={data.summary.incomeCents} />
        </Stat>
        <Stat icon="down" label="Saídas" tone="loss">
          <Money cents={data.summary.netExpenseCents} />
        </Stat>
        <Stat icon="piggy" label="Resultado" hint={savings !== null && savings > 0 ? `${savings}% guardado` : undefined}>
          <Money cents={data.summary.resultCents} sign />
        </Stat>
      </section>

      <section aria-label="Panorama" className="glass grid grid-cols-3 divide-x divide-line rounded-[24px] py-4 text-center sm:text-left">
        {[
          ["Comprometido", committed],
          ["A receber", data.avail.receivablesCents],
          ["Projeção do mês", data.avail.projectedCents],
        ].map(([label, cents]) => (
          <div key={label as string} className="px-3 sm:px-6">
            <p className="text-xs font-medium text-ink-faint sm:text-sm">{label}</p>
            <p className="money mt-0.5 text-[0.95rem] font-semibold sm:text-lg">
              <Money cents={cents as number} />
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="grid content-start gap-6">
          <Panel title="Para onde vai seu dinheiro" action={<PanelLink href="/app/relatorios">Relatório</PanelLink>}>
            {breakdown.length === 0 ? (
              <Empty title="Nenhuma despesa neste mês">Mande “gastei 50 no mercado” no WhatsApp ou adicione pelo painel.</Empty>
            ) : (
              <>
                {paceDelta !== null && (
                  <p className="-mt-2 mb-4 text-sm text-ink-soft">
                    <span className={paceDelta > 0 ? "font-semibold text-loss" : "font-semibold text-gain"}>
                      {paceDelta > 0 ? "▲" : "▼"} {Math.abs(paceDelta)}%
                    </span>{" "}
                    vs mesmo período de {prevName}
                  </p>
                )}
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

          <Panel title="Últimas movimentações" action={<PanelLink href="/app/lancamentos">Ver todas</PanelLink>}>
            {data.recent.length === 0 ? (
              <Empty title="Nada por aqui ainda">Seus registros pelo WhatsApp aparecem aqui na hora.</Empty>
            ) : (
              <ul className="grid">
                {data.recent.map((t, i) => {
                  const cents = t.kind === "income" || t.kind === "refund" ? t.amountCents : t.kind === "expense" ? -t.amountCents : 0;
                  return (
                    <li key={t.id} className={`flex items-center gap-3 py-3 ${i ? "border-t border-line" : ""}`}>
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] text-lg ${cents > 0 ? "bg-gain-soft" : "bg-paper"}`} aria-hidden="true">
                        {t.categoryIcon || "•"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{t.description}</p>
                        <p className="truncate text-xs text-ink-faint">
                          {formatBR(t.occurredOn)} · {t.accountName}
                          {t.status === "pending" ? " · a pagar" : ""}
                        </p>
                      </div>
                      <Money cents={cents} sign className="shrink-0 font-semibold" />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Limites do mês" action={<PanelLink href="/app/limites">{data.budgets.length ? "Gerenciar" : "Criar"}</PanelLink>}>
            {data.budgets.length === 0 ? (
              <p className="text-sm text-ink-soft">Defina quanto quer gastar por categoria e receba um aviso no WhatsApp ao chegar em 80%. Ex.: “limite de 800 para mercado”.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-x-2 gap-y-5">
                {data.budgets.slice(0, 6).map((b) => (
                  <li key={b.id} className="grid justify-items-center text-center">
                    <span className="relative grid place-items-center">
                      <Ring pct={b.pct} size={74} stroke={7} color={b.pct >= 100 ? "var(--color-loss)" : b.pct >= 80 ? "var(--color-coin)" : "var(--color-gain)"} />
                      <b className="absolute text-[0.95rem] tracking-[-0.03em]">{b.pct}%</b>
                    </span>
                    <span className="mt-2 w-full truncate text-sm font-semibold">
                      {b.icon} {b.name}
                    </span>
                    <span className="money text-[0.7rem] text-ink-faint">
                      {formatBRL(b.spentCents)} de {formatBRL(b.limitCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {data.methods.some((m) => m.method) && (
            <Panel title="Como você pagou" action={<PanelLink href={`/app/lancamentos?mes=${month.from.slice(0, 7)}`}>Ver</PanelLink>}>
              <ul className="grid gap-2.5">
                {(() => {
                  const total = data.methods.reduce((s, m) => s + m.totalCents, 0) || 1;
                  return data.methods.map((m) => {
                    const pct = Math.round((m.totalCents / total) * 100);
                    const known = isPaymentMethod(m.method);
                    return (
                      <li key={m.method ?? "none"}>
                        <Link href={`/app/lancamentos?mes=${month.from.slice(0, 7)}&tipo=expense&forma=${known ? m.method : "nenhuma"}`} className="grid gap-1.5 rounded-[14px] px-1 py-1 hover:bg-paper">
                          <span className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium">{known ? `${PAYMENT_METHOD_ICONS[m.method as keyof typeof PAYMENT_METHOD_ICONS]} ${PAYMENT_METHOD_LABELS[m.method as keyof typeof PAYMENT_METHOD_LABELS]}` : "❔ Sem forma informada"}</span>
                            <span className="money font-semibold">{formatBRL(m.totalCents)}</span>
                          </span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-line">
                            <span className="block h-full rounded-full bg-gain" style={{ width: `${pct}%` }} />
                          </span>
                        </Link>
                      </li>
                    );
                  });
                })()}
              </ul>
            </Panel>
          )}
          <Panel title="Vencendo nos próximos 15 dias">
            {data.due.length === 0 ? (
              <p className="text-sm text-ink-soft">Nenhuma conta a pagar no período.</p>
            ) : (
              <ul className="grid gap-2">
                {data.due.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-[16px] bg-paper px-3 py-2.5 text-sm">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-xs font-bold ${t.dueOn && t.dueOn < today ? "bg-loss-soft text-loss" : "bg-coin-soft text-coin"}`}>
                      {t.dueOn ? formatBR(t.dueOn).slice(0, 2) : "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{t.description}</span>
                    <Money cents={t.amountCents} className="font-semibold" />
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
