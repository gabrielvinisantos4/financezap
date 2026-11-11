import { requireAdmin, can } from "@/server/auth/session";
import { listAffiliatesForAdmin, listPayoutsForAdmin, maskPixKey } from "@/server/affiliates/affiliates";
import { createPayoutsAction, payoutAction, setAffiliateStatusAction } from "@/app/actions/affiliates";
import { ActionForm, Submit } from "@/components/forms";
import { Badge, Empty, Money, PageHeader, Panel, Stat } from "@/components/ui";

export const metadata = { title: "Afiliados" };
export const dynamic = "force-dynamic";

const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");

export default async function AdminAffiliates() {
  const admin = await requireAdmin("manage_users");
  const pii = can(admin, "view_pii");
  const [rows, payouts] = await Promise.all([listAffiliatesForAdmin(), listPayoutsForAdmin()]);
  const canPay = can(admin, "manage_plans");
  const LABEL = { awaiting_approval: "Aguardando aprovação", processing: "Enviando", paid: "Pago", failed: "Falhou", canceled: "Cancelado" } as const;
  const TONE = { awaiting_approval: "coin", processing: "coin", paid: "gain", failed: "loss", canceled: "neutral" } as const;
  const tot = rows.reduce((a, r) => ({ paying: a.paying + r.paying, last30: a.last30 + r.last30Cents, total: a.total + r.totalCents }), { paying: 0, last30: 0, total: 0 });
  return (
    <>
      <PageHeader title="Afiliados" description="Comissões pagas automaticamente pelo split do Asaas. Bloquear um afiliado tira o split das assinaturas dos indicados dele." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="users" label="Afiliados">{rows.length}</Stat>
        <Stat icon="star" label="Assinantes indicados">{tot.paying}</Stat>
        <Stat icon="cash" label="Comissões (30 dias)"><Money cents={tot.last30} /></Stat>
        <Stat icon="wallet" label="Comissões (total)"><Money cents={tot.total} /></Stat>
      </div>
      <Panel title="Pagamentos por Pix" className="mb-6">
        <div className="grid gap-4 text-sm text-ink-soft">
          <p>Afiliados que escolheram Pix recebem uma vez por mês. Gere os repasses (entram as comissões com mais de 7 dias, a partir de R$ 20), confira e aprove. O Pix sai do saldo do Asaas; se o Asaas pedir, autorize no app.</p>
          {canPay && (
            <ActionForm action={createPayoutsAction} className="flex">
              <Submit pendingText="Calculando…" className="btn btn-primary w-fit">Gerar pagamentos do mês</Submit>
            </ActionForm>
          )}
          {payouts.length === 0 ? (
            <p className="text-ink-faint">Nenhum repasse ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {payouts.map(({ p, name, code }) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <b className="text-ink">{name}</b> <span className="text-ink-faint">/r/{code}</span>
                    <small className="block">
                      {p.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · Pix {p.pixKeyType} {pii ? p.pixKey : maskPixKey(p.pixKeyType, p.pixKey)}
                      {p.failReason ? ` · ${p.failReason}` : ""}
                    </small>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-ink"><Money cents={p.amountCents} /></b>
                    <Badge tone={TONE[p.status]}>{LABEL[p.status]}</Badge>
                    {canPay && p.status === "awaiting_approval" && (
                      <>
                        <ActionForm action={payoutAction} className="flex">
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="op" value="approve" />
                          <Submit pendingText="Enviando…" className="btn btn-primary py-1.5 text-sm">Pagar via Pix</Submit>
                        </ActionForm>
                        <ActionForm action={payoutAction} className="flex">
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="op" value="cancel" />
                          <Submit pendingText="…" className="btn btn-ghost py-1.5 text-sm">Cancelar</Submit>
                        </ActionForm>
                      </>
                    )}
                    {canPay && (p.status === "awaiting_approval" || p.status === "processing") && (
                      <ActionForm action={payoutAction} className="flex">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="op" value="paid" />
                        <Submit pendingText="…" className="btn btn-ghost py-1.5 text-sm">Já paguei</Submit>
                      </ActionForm>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      {rows.length === 0 ? (
        <Empty title="Nenhum afiliado ainda">Divulgue a página /afiliados.</Empty>
      ) : (
        <div className="grid gap-4">
          {rows.map((r) => (
            <Panel key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold">{r.name} <span className="text-ink-faint">· /r/{r.code}</span></p>
                  <p className="text-sm text-ink-soft">{pii ? r.email : mask(r.email)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={r.status === "active" ? "gain" : "loss"}>{r.status === "active" ? "Ativo" : "Bloqueado"}</Badge>
                    <Badge tone={(r.payoutMethod === "pix" ? r.pixKey : r.walletId) ? "gain" : "coin"}>{r.payoutMethod === "pix" ? (r.pixKey ? "Recebe por Pix" : "Sem chave Pix") : r.walletId ? "Recebe pelo Asaas" : "Sem carteira"}</Badge>
                    <Badge>{r.commissionBps / 100}%</Badge>
                    <Badge>{r.clicks} cliques · {r.signups} cadastros · {r.paying} assinantes</Badge>
                    <Badge tone="gain">30 dias: {(r.last30Cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</Badge>
                  </div>
                  {r.blockedReason && <p className="mt-2 text-sm text-loss">Motivo: {r.blockedReason}</p>}
                </div>
                <form action={setAffiliateStatusAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value={r.status === "active" ? "blocked" : "active"} />
                  {r.status === "active" && <input className="input py-2 text-sm" name="reason" placeholder="Motivo do bloqueio" required />}
                  <button className={`btn ${r.status === "active" ? "btn-danger" : "btn-primary"} py-2 text-sm`}>{r.status === "active" ? "Bloquear" : "Reativar"}</button>
                </form>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
