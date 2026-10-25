import Link from "next/link";
import { withUser } from "@/server/db/client";
import { monthlyEvolution, periodSummary, totalsByCategory, totalsByParty } from "@/server/finance/queries";
import { addMonths, monthLabel } from "@/server/finance/dates";
import { appContext, monthFromParam } from "@/server/app-context";
import { getEntitlement } from "@/server/billing/entitlements";
import { Empty, Money, PageHeader, Panel } from "@/components/ui";
import { EvolutionChart } from "@/components/evolution-chart";

export const metadata = { title: "Relatórios" };

export default async function Reports({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const { user, today } = await appContext();
  const period = monthFromParam(sp.mes, today);
  const ent = await getEntitlement(user.id);
  const advanced = ent.active && ent.limits.advancedReports;
  const d = await withUser(user.id, async (tx) => ({
    summary: await periodSummary(tx, user.id, period),
    expense: await totalsByCategory(tx, user.id, period, "expense"),
    income: await totalsByCategory(tx, user.id, period, "income"),
    merchants: await totalsByParty(tx, user.id, period, "expense"),
    clients: await totalsByParty(tx, user.id, period, "income"),
    evolution: advanced ? await monthlyEvolution(tx, user.id, period.from, 6) : [],
  }));
  const prev = addMonths(period.from, -1).slice(0, 7);
  const next = addMonths(period.from, 1).slice(0, 7);

  return (
    <>
      <PageHeader title={`Relatório de ${monthLabel(period.from)}`} description="Resultado pelo regime de competência: compras no cartão entram na data da compra; transferências e pagamentos de fatura não contam.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`?mes=${prev}`} className="btn btn-ghost px-3 py-1.5" aria-label="Mês anterior">‹</Link>
          <Link href={`?mes=${next}`} className="btn btn-ghost px-3 py-1.5" aria-label="Próximo mês">›</Link>
          <a href={`/app/relatorios/csv?mes=${period.key}`} className="btn btn-ghost px-3 py-1.5">Baixar CSV</a>
        </div>
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ["Entradas", d.summary.incomeCents, "text-gain"],
          ["Saídas", d.summary.netExpenseCents, "text-loss"],
          ["Resultado", d.summary.resultCents, ""],
        ].map(([label, v, cls]) => (
          <div key={label as string} className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-sm text-ink-soft">{label}</p>
            <p className={`wide money mt-1 text-3xl ${cls}`}><Money cents={v as number} /></p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {([["Despesas por categoria", d.expense], ["Receitas por categoria", d.income]] as const).map(([title, rows]) => {
          const total = rows.reduce((s, r) => s + r.totalCents, 0);
          return (
            <Panel key={title} title={title}>
              {rows.length === 0 ? (
                <Empty title="Sem lançamentos neste mês" />
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {rows.map((r) => (
                      <tr key={r.categoryId ?? "x"}>
                        <th scope="row" className="py-2 text-left font-normal">{r.icon} {r.name}</th>
                        <td className="py-2 text-right text-ink-faint">{total ? Math.round((r.totalCents / total) * 100) : 0}%</td>
                        <td className="py-2 text-right font-semibold"><Money cents={r.totalCents} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          );
        })}
        <Panel title="Onde você mais gastou">
          {d.merchants.length === 0 ? <Empty title="Sem estabelecimentos registrados" /> : (
            <ul className="divide-y divide-line text-sm">
              {d.merchants.slice(0, 10).map((m) => (
                <li key={m.party} className="flex justify-between py-2"><span>{m.party} <span className="text-ink-faint">({m.count})</span></span><Money cents={m.totalCents} className="font-semibold" /></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recebimentos por cliente">
          {d.clients.length === 0 ? <Empty title="Sem recebimentos registrados" /> : (
            <ul className="divide-y divide-line text-sm">
              {d.clients.slice(0, 10).map((m) => (
                <li key={m.party} className="flex justify-between py-2"><span>{m.party} <span className="text-ink-faint">({m.count})</span></span><Money cents={m.totalCents} className="font-semibold" /></li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Evolução dos últimos 6 meses" className="lg:col-span-2">
          {advanced ? (
            <EvolutionChart data={d.evolution.map((e) => ({ label: monthLabel(e.month).replace(/\/\d+$/, ""), income: e.incomeCents, expense: e.expenseCents }))} />
          ) : (
            <p className="text-sm text-ink-soft">A evolução mensal faz parte dos relatórios avançados do plano Pro. <Link href="/app/assinatura" className="font-semibold underline">Ver planos</Link></p>
          )}
        </Panel>
      </div>
    </>
  );
}
