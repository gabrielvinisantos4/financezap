import { requireAdmin } from "@/server/auth/session";
import { businessMetrics } from "@/server/admin/admin";
import { integrations } from "@/server/config/env";
import { Badge, Money, PageHeader, Panel } from "@/components/ui";

export const metadata = { title: "Negócio" };
export const dynamic = "force-dynamic";

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="wide money mt-1 text-3xl">{children}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

export default async function AdminHome() {
  await requireAdmin("view_metrics");
  const m = await businessMetrics();
  const margin = m.mrrCents - m.costsMonth.totalBrlCents;
  return (
    <>
      <PageHeader title="Negócio" description="Números da operação. Nenhum dado financeiro pessoal dos clientes aparece aqui.">
        <div className="flex flex-wrap gap-2">
          <Badge tone={integrations.whatsappConfigured() ? "gain" : "loss"}>WhatsApp {integrations.whatsappConfigured() ? "configurado" : "sem credenciais"}</Badge>
          <Badge tone={integrations.openaiConfigured() ? "gain" : "coin"}>IA {integrations.openaiConfigured() ? "configurada" : "modo regras"}</Badge>
          <Badge tone={integrations.asaasConfigured() ? "gain" : "loss"}>Asaas {integrations.asaasConfigured() ? "configurado" : "sem credenciais"}</Badge>
        </div>
      </PageHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Receita recorrente mensal" hint="Assinaturas pagas ativas; anuais divididas por 12"><Money cents={m.mrrCents} /></Stat>
        <Stat label="Assinantes ativos" hint={m.subscriptions.courtesy ? `${m.subscriptions.courtesy} em cortesia` : undefined}>{m.subscriptions.active}</Stat>
        <Stat label="Clientes cadastrados" hint={`${m.users.new30} novos em 30 dias`}>{m.users.total}</Stat>
        <Stat label="Margem estimada do mês" hint="MRR menos custos variáveis medidos (IA + WhatsApp)"><Money cents={margin} /></Stat>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Assinaturas">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between"><dt>Em atraso</dt><dd className="money font-semibold text-loss">{m.subscriptions.pastDue}</dd></div>
            <div className="flex justify-between"><dt>Aguardando 1º pagamento</dt><dd className="money font-semibold">{m.subscriptions.pending}</dd></div>
            <div className="flex justify-between"><dt>Cancelamentos (30 dias)</dt><dd className="money font-semibold">{m.subscriptions.canceled30}</dd></div>
            <div className="flex justify-between"><dt>Clientes bloqueados</dt><dd className="money font-semibold">{m.users.blocked}</dd></div>
          </dl>
          <h3 className="wide mt-5 text-sm">Planos mais vendidos</h3>
          <ul className="mt-2 grid gap-1 text-sm">
            {m.subscriptions.byPlan.length === 0 ? <li className="text-ink-faint">Nenhuma assinatura ativa.</li> : m.subscriptions.byPlan.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name}</span><span className="money">{p.count}</span></li>)}
          </ul>
        </Panel>
        <Panel title="Uso neste mês">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between"><dt>Mensagens recebidas</dt><dd className="money">{m.usageMonth.inbound.toLocaleString("pt-BR")}</dd></div>
            <div className="flex justify-between"><dt>Respostas enviadas</dt><dd className="money">{m.usageMonth.outbound.toLocaleString("pt-BR")}</dd></div>
            <div className="flex justify-between"><dt>Chamadas de IA</dt><dd className="money">{m.usageMonth.aiCalls.toLocaleString("pt-BR")}</dd></div>
            <div className="flex justify-between"><dt>Tokens (entrada / saída)</dt><dd className="money">{m.usageMonth.tokensIn.toLocaleString("pt-BR")} / {m.usageMonth.tokensOut.toLocaleString("pt-BR")}</dd></div>
          </dl>
        </Panel>
        <Panel title="Custos e falhas">
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between"><dt>IA (estimado)</dt><dd><Money cents={m.costsMonth.aiBrlCents} /></dd></div>
            <div className="flex justify-between"><dt>WhatsApp (estimado)</dt><dd><Money cents={m.costsMonth.whatsappBrlCents} /></dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total variável</dt><dd><Money cents={m.costsMonth.totalBrlCents} /></dd></div>
            <div className="mt-3 flex justify-between"><dt>Mensagens com falha (30 dias)</dt><dd className={`money font-semibold ${m.processing.failed30 ? "text-loss" : ""}`}>{m.processing.failed30}</dd></div>
            <div className="flex justify-between"><dt>Na fila agora</dt><dd className="money">{m.processing.inQueue}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-ink-faint">Custos estimados pelos preços configurados nas variáveis de ambiente. Hospedagem, banco e taxas do gateway não entram aqui.</p>
        </Panel>
      </div>
    </>
  );
}
