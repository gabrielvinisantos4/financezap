import { requireAdmin, can } from "@/server/auth/session";
import { listAllPlans, searchCustomers } from "@/server/admin/admin";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { blockUserAction, grantCourtesyAction } from "@/app/actions/admin";

export const metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requireAdmin("manage_users");
  const { q = "" } = await searchParams;
  const pii = can(admin, "view_pii");
  const [rows, plans] = await Promise.all([searchCustomers(admin, q.slice(0, 120), pii), listAllPlans()]);
  const canPlans = can(admin, "manage_plans");

  return (
    <>
      <PageHeader title="Clientes" description={pii ? "Você tem permissão para ver dados pessoais. Buscas ficam registradas na auditoria." : "Dados pessoais aparecem mascarados. Busque pelo identificador do cliente."} />
      <form className="mb-6 flex max-w-xl gap-2" role="search">
        <input className="input" name="q" defaultValue={q} placeholder={pii ? "Identificador ou e-mail" : "Identificador do cliente (UUID)"} aria-label="Buscar cliente" />
        <button className="btn btn-primary">Buscar</button>
      </form>
      <div className="grid gap-4">
        {rows.length === 0 && <p className="text-ink-soft">Nenhum cliente encontrado.</p>}
        {rows.map((c) => (
          <Panel key={c.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="wide">{c.name}</p>
                <p className="text-sm text-ink-soft">{c.email} · {c.phone}</p>
                <p className="mt-1 break-all font-mono text-xs text-ink-faint">{c.id}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={c.status === "active" ? "gain" : c.status === "blocked" ? "loss" : "neutral"}>{c.status === "active" ? "Ativo" : c.status === "blocked" ? "Bloqueado" : "Excluído"}</Badge>
                  {c.role !== "user" && <Badge tone="coin">{c.role}</Badge>}
                  <Badge>{c.plan ? `${c.plan} · ${c.subStatus}` : "sem assinatura"}</Badge>
                  <Badge tone={c.whatsappLinked ? "gain" : "neutral"}>{c.whatsappLinked ? "WhatsApp vinculado" : "sem WhatsApp"}</Badge>
                </div>
              </div>
              {c.status !== "deleted" && c.role !== "owner" && (
                <div className="grid w-full gap-4 sm:w-auto sm:grid-cols-2">
                  <ActionForm action={blockUserAction} className="grid gap-2">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="block" value={c.status === "blocked" ? "0" : "1"} />
                    <input className="input py-2 text-sm" name="reason" placeholder="Motivo (obrigatório)" required />
                    <Submit className={`btn ${c.status === "blocked" ? "btn-primary" : "btn-danger"} py-2 text-sm`}>{c.status === "blocked" ? "Reativar acesso" : "Bloquear acesso"}</Submit>
                  </ActionForm>
                  {canPlans && (
                    <ActionForm action={grantCourtesyAction} className="grid gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <div className="flex gap-2">
                        <select className="input py-2 text-sm" name="plan" aria-label="Plano">
                          {plans.map((p) => <option key={p.id} value={p.slug}>{p.name}</option>)}
                        </select>
                        <input className="input w-20 py-2 text-sm" name="days" type="number" min={1} max={365} defaultValue={30} aria-label="Dias" />
                      </div>
                      <Submit className="btn btn-ghost py-2 text-sm">Liberar cortesia</Submit>
                    </ActionForm>
                  )}
                </div>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
