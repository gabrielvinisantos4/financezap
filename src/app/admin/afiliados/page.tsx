import { requireAdmin, can } from "@/server/auth/session";
import { listAffiliatesForAdmin } from "@/server/affiliates/affiliates";
import { setAffiliateStatusAction } from "@/app/actions/affiliates";
import { Badge, Empty, Money, PageHeader, Panel, Stat } from "@/components/ui";

export const metadata = { title: "Afiliados" };
export const dynamic = "force-dynamic";

const mask = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");

export default async function AdminAffiliates() {
  const admin = await requireAdmin("manage_users");
  const pii = can(admin, "view_pii");
  const rows = await listAffiliatesForAdmin();
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
                    <Badge tone={r.walletId ? "gain" : "coin"}>{r.walletId ? "Carteira Asaas ok" : "Sem carteira"}</Badge>
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
