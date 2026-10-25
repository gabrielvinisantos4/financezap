import { requireAdmin } from "@/server/auth/session";
import { auditLog, failedMessages, recentOperationalEvents } from "@/server/admin/admin";
import { Badge, PageHeader, Panel } from "@/components/ui";

export const metadata = { title: "Operação" };
export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function Events({ searchParams }: { searchParams: Promise<{ nivel?: string }> }) {
  await requireAdmin("view_metrics");
  const { nivel } = await searchParams;
  const level = ["info", "warn", "error"].includes(nivel ?? "") ? nivel : undefined;
  const [events, failed, audits] = await Promise.all([recentOperationalEvents(80, level), failedMessages(), auditLog(40)]);
  return (
    <>
      <PageHeader title="Operação" description="Falhas e eventos do sistema. Os registros não guardam o conteúdo das mensagens nem valores dos clientes." />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Eventos" action={
          <nav className="flex gap-2 text-sm">
            {[["", "Todos"], ["error", "Erros"], ["warn", "Alertas"], ["info", "Info"]].map(([v, l]) => (
              <a key={v} href={v ? `?nivel=${v}` : "?"} className={(level ?? "") === v ? "font-semibold underline" : "text-ink-soft"}>{l}</a>
            ))}
          </nav>
        }>
          <ul className="divide-y divide-line text-sm">
            {events.length === 0 && <li className="py-3 text-ink-faint">Nada registrado.</li>}
            {events.map((e) => (
              <li key={e.id} className="grid gap-1 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.level === "error" ? "loss" : e.level === "warn" ? "coin" : "neutral"}>{e.level}</Badge>
                  <span className="font-mono text-xs">{e.type}</span>
                  <span className="ml-auto text-xs text-ink-faint">{fmt(e.createdAt)}</span>
                </div>
                <p>{e.message}</p>
                {e.meta ? <p className="break-all font-mono text-xs text-ink-faint">{JSON.stringify(e.meta)}</p> : null}
              </li>
            ))}
          </ul>
        </Panel>
        <div className="grid content-start gap-6">
          <Panel title="Mensagens com falha definitiva">
            <ul className="divide-y divide-line text-sm">
              {failed.length === 0 && <li className="py-2 text-ink-faint">Nenhuma.</li>}
              {failed.map((f) => (
                <li key={f.id} className="py-2">
                  <p className="text-xs text-ink-faint">{fmt(f.receivedAt)} · {f.attempts} tentativas</p>
                  <p className="break-all">{f.error}</p>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Auditoria administrativa">
            <ul className="divide-y divide-line text-sm">
              {audits.length === 0 && <li className="py-2 text-ink-faint">Nenhuma ação registrada.</li>}
              {audits.map((a) => (
                <li key={a.log.id} className="py-2">
                  <p><span className="font-semibold">{a.adminName}</span> · <span className="font-mono text-xs">{a.log.action}</span></p>
                  <p className="text-xs text-ink-faint">{fmt(a.log.createdAt)}{a.log.reason ? ` · ${a.log.reason}` : ""}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
