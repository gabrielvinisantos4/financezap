import { requireAdmin, can } from "@/server/auth/session";
import { listStalledSignups, RECOVERY_COOLDOWN_DAYS } from "@/server/admin/recovery";
import { sendRecoveryAction } from "@/app/actions/admin";
import { ActionForm, Submit } from "@/components/forms";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/components/ui";
import { env } from "@/server/config/env";

export const metadata = { title: "Cadastros parados" };
export const dynamic = "force-dynamic";

const maskPhone = (p: string) => `(${p.slice(2, 4)}) •••••-${p.slice(-4)}`;
const fmtPhone = (p: string) => `(${p.slice(2, 4)}) ${p.slice(4, -4)}-${p.slice(-4)}`;
const ago = (d: Date) => {
  const h = Math.floor((Date.now() - d.getTime()) / 3600_000);
  if (h < 1) return "há menos de 1 h";
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
};

export default async function StalledSignups() {
  const admin = await requireAdmin("manage_users");
  const pii = can(admin, "view_pii");
  const rows = await listStalledSignups();
  const accountOnly = rows.filter((r) => r.stage === "account_only").length;
  return (
    <>
      <PageHeader title="Cadastros parados" description="Quem criou a conta nos últimos 60 dias e não chegou a ativar o teste nem assinar. Um clique manda uma mensagem pelo WhatsApp do FinanceZap chamando para terminar." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat icon="users" label="Parados">{rows.length}</Stat>
        <Stat icon="user" label="Só criaram a conta">{accountOnly}</Stat>
        <Stat icon="card" label="Pararam no pagamento">{rows.length - accountOnly}</Stat>
      </div>
      <p className="mb-5 rounded-[16px] bg-paper px-4 py-3 text-sm text-ink-soft">
        A mensagem usa o modelo <b className="text-ink">{env().RECOVERY_TEMPLATE_NAME}</b>, aprovado pela Meta (é o único jeito de chamar quem nunca falou com o robô). Cada pessoa recebe no máximo 3 vezes, com {RECOVERY_COOLDOWN_DAYS} dias de intervalo.
      </p>
      {rows.length === 0 ? (
        <Empty title="Ninguém parado">Todo mundo que se cadastrou virou cliente. 🎉</Empty>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-sm text-ink-soft">
                    {r.phone ? (pii ? fmtPhone(r.phone) : maskPhone(r.phone)) : "sem WhatsApp"} · cadastrou {ago(r.createdAt)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={r.stage === "checkout_abandoned" ? "coin" : "neutral"}>{r.stage === "checkout_abandoned" ? "Parou no pagamento" : "Só criou a conta"}</Badge>
                    {r.recoveryCount > 0 && r.recoverySentAt && <Badge tone="gain">Mensagem enviada {r.recoveryCount}x · última {ago(r.recoverySentAt)}</Badge>}
                  </div>
                </div>
                {r.canSend ? (
                  <ActionForm action={sendRecoveryAction} className="grid justify-items-end gap-1">
                    <input type="hidden" name="id" value={r.id} />
                    <Submit pendingText="Enviando…" className="btn btn-primary py-2 text-sm">{r.recoveryCount ? "Enviar de novo" : "Chamar no WhatsApp"}</Submit>
                  </ActionForm>
                ) : (
                  <span className="text-sm text-ink-faint">{r.blockedReason}</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
