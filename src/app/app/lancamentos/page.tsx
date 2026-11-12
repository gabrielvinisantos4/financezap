import Link from "next/link";
import { withUser } from "@/server/db/client";
import { listTransactions } from "@/server/finance/queries";
import { getTransaction, listAccounts, listCategories } from "@/server/finance/engine";
import { addMonths, formatBR, monthLabel } from "@/server/finance/dates";
import { isPaymentMethod, PAYMENT_METHOD_ICONS, PAYMENT_METHOD_LABELS } from "@/server/finance/payment-methods";
import { appContext, monthFromParam } from "@/server/app-context";
import { Badge, Empty, Money, PageHeader, Panel } from "@/components/ui";
import { EntryForm } from "@/components/entry-form";
import { ActionForm, ConfirmButton, Submit } from "@/components/forms";
import { deleteEntryAction, markPaidAction, refundAction } from "@/app/actions/app";

export const metadata = { title: "Lançamentos" };

const KIND = { income: "Receita", expense: "Despesa", transfer: "Transferência", card_payment: "Pagamento de fatura", refund: "Estorno" } as const;

type SP = { mes?: string; tipo?: string; categoria?: string; conta?: string; forma?: string; busca?: string; editar?: string; pagina?: string };

export default async function Entries({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { user, today } = await appContext();
  const period = monthFromParam(sp.mes, today);
  const page = Math.max(1, Number(sp.pagina) || 1);
  const kind = ["income", "expense", "transfer", "card_payment", "refund"].includes(sp.tipo ?? "") ? (sp.tipo as keyof typeof KIND) : undefined;
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

  const data = await withUser(user.id, async (tx) => {
    const rows = await listTransactions(tx, user.id, {
      period,
      kind,
      categoryId: uuid(sp.categoria),
      accountId: uuid(sp.conta),
      search: sp.busca?.slice(0, 60) || undefined,
      paymentMethod: sp.forma && (isPaymentMethod(sp.forma) || sp.forma === "nenhuma") ? sp.forma : undefined,
      limit: 51,
      offset: (page - 1) * 50,
    });
    const editing = uuid(sp.editar) ? await getTransaction(tx, user.id, sp.editar!).catch(() => null) : null;
    return { rows, editing, categories: await listCategories(tx, user.id), accounts: await listAccounts(tx, user.id) };
  });
  const hasMore = data.rows.length > 50;
  const rows = data.rows.slice(0, 50);
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, editar: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };
  const prevMonth = addMonths(period.from, -1).slice(0, 7);
  const nextMonth = addMonths(period.from, 1).slice(0, 7);
  const cats = data.categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, icon: c.icon }));
  const accs = data.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }));

  return (
    <>
      <PageHeader title="Lançamentos" description="Tudo o que você registrou, pelo WhatsApp ou pelo painel.">
        <div className="flex items-center gap-1 rounded-full border border-line bg-surface p-1 text-sm">
          <Link href={qs({ mes: prevMonth, pagina: undefined })} className="lg-ghost rounded-full px-3 py-1.5" aria-label="Mês anterior">‹</Link>
          <span className="wide px-2 capitalize">{monthLabel(period.from)}</span>
          <Link href={qs({ mes: nextMonth, pagina: undefined })} className="lg-ghost rounded-full px-3 py-1.5" aria-label="Próximo mês">›</Link>
        </div>
      </PageHeader>

      <form className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search">
        <input type="hidden" name="mes" value={period.key} />
        <input className="input lg:col-span-2" name="busca" placeholder="Buscar por descrição, local ou cliente" defaultValue={sp.busca} aria-label="Buscar" />
        <select className="input" name="tipo" defaultValue={sp.tipo ?? ""} aria-label="Tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(KIND).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="input" name="categoria" defaultValue={sp.categoria ?? ""} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </select>
        <select className="input" name="forma" defaultValue={sp.forma ?? ""} aria-label="Forma de pagamento">
          <option value="">Todas as formas</option>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
          <option value="nenhuma">Sem forma informada</option>
        </select>
        <div className="flex gap-2">
          <select className="input" name="conta" defaultValue={sp.conta ?? ""} aria-label="Conta">
            <option value="">Todas as contas</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button className="btn btn-primary shrink-0">Filtrar</button>
        </div>
      </form>

      {data.editing && (
        <Panel title="Editar lançamento" className="mb-6" action={<Link href={qs({})} className="text-sm">Fechar</Link>}>
          {data.editing.kind === "income" || data.editing.kind === "expense" ? (
            <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
              <EntryForm
                categories={cats}
                accounts={accs}
                defaults={{
                  id: data.editing.id,
                  version: data.editing.version,
                  kind: data.editing.kind,
                  amount: (data.editing.amountCents / 100).toFixed(2).replace(".", ","),
                  description: data.editing.description,
                  party: data.editing.kind === "expense" ? data.editing.merchant : data.editing.counterparty,
                  categoryId: data.editing.categoryId,
                  accountId: data.editing.accountId,
                  occurredOn: data.editing.status === "pending" ? (data.editing.dueOn ?? data.editing.occurredOn) : data.editing.occurredOn,
                  pending: data.editing.status === "pending",
                  notes: data.editing.notes,
                  paymentMethod: data.editing.paymentMethod,
                }}
              />
              {data.editing.kind === "expense" && (
                <div>
                  <h3 className="wide mb-2">Registrar estorno</h3>
                  <p className="mb-3 text-sm text-ink-soft">Use quando a loja devolveu parte ou todo o valor. Deixe em branco para estornar o total.</p>
                  <ActionForm action={refundAction}>
                    <input type="hidden" name="id" value={data.editing.id} />
                    <label className="field">
                      <span>Valor do estorno (R$)</span>
                      <input className="input money" name="amount" inputMode="decimal" placeholder="Total" />
                    </label>
                    <Submit className="btn btn-ghost">Registrar estorno</Submit>
                  </ActionForm>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Transferências, pagamentos de fatura e estornos podem ser excluídos e lançados de novo.</p>
          )}
        </Panel>
      )}

      <Panel className="p-0 sm:p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <Empty title="Nenhum lançamento encontrado">Ajuste os filtros ou troque o mês.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Lançamentos de {monthLabel(period.from)}</caption>
              <thead className="border-b border-line text-left text-ink-faint">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Data</th>
                  <th scope="col" className="px-3 py-3 font-medium">Descrição</th>
                  <th scope="col" className="px-3 py-3 font-medium">Categoria</th>
                  <th scope="col" className="px-3 py-3 font-medium">Conta</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">Valor</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((t) => {
                  const signed = t.kind === "income" || t.kind === "refund" ? t.amountCents : t.kind === "expense" ? -t.amountCents : 0;
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="whitespace-nowrap px-5 py-3 text-ink-soft">{formatBR(t.occurredOn)}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium">{t.description}</p>
                        <p className="text-xs text-ink-faint">
                          {[t.merchant, t.counterparty].filter(Boolean).join(" · ")}
                          {t.source === "whatsapp" ? " via WhatsApp" : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {t.kind !== "income" && t.kind !== "expense" && <Badge>{KIND[t.kind]}</Badge>}
                          {isPaymentMethod(t.paymentMethod) && <Badge>{PAYMENT_METHOD_ICONS[t.paymentMethod]} {PAYMENT_METHOD_LABELS[t.paymentMethod]}</Badge>}
                          {t.status === "pending" && <Badge tone="coin">{t.kind === "income" ? "A receber" : "A pagar"} {t.dueOn ? formatBR(t.dueOn).slice(0, 5) : ""}</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3">{t.categoryName ? `${t.categoryIcon} ${t.categoryName}` : "—"}</td>
                      <td className="px-3 py-3">{t.accountName}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">
                        {signed === 0 ? <Money cents={t.amountCents} /> : <Money cents={signed} sign />}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <div className="flex justify-end gap-3">
                          {t.status === "pending" && (
                            <form action={markPaidAction}>
                              <input type="hidden" name="id" value={t.id} />
                              <button className="text-sm font-semibold text-gain">Marcar pago</button>
                            </form>
                          )}
                          <Link href={qs({ editar: t.id })} className="text-sm font-semibold">Editar</Link>
                          <form action={deleteEntryAction}>
                            <input type="hidden" name="id" value={t.id} />
                            {t.installmentGroupId && <input type="hidden" name="group" value="on" />}
                            <ConfirmButton message={t.installmentGroupId ? "Excluir este lançamento e todas as parcelas?" : "Excluir este lançamento?"}>Excluir</ConfirmButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link href={qs({ pagina: String(page - 1) })} className="font-semibold">Página anterior</Link> : <span />}
        {hasMore && <Link href={qs({ pagina: String(page + 1) })} className="font-semibold">Próxima página</Link>}
      </div>
      <div className="mt-8 flex justify-center">
        <Link href="/app/conta#apagar-lancamentos" className="lg-btn inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-loss">
          Apagar lançamentos
        </Link>
      </div>
    </>
  );
}
