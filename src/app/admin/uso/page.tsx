import Link from "next/link";
import { can, requireAdmin } from "@/server/auth/session";
import { ACCESS_LABELS, LIVE_ACCESS, USAGE_HINTS, USAGE_LABELS, usageOverview, type UsageBucket, type UsageRow } from "@/server/admin/admin";
import { Badge, Empty, PageHeader, Panel, Stat } from "@/components/ui";

export const metadata = { title: "Uso dos clientes" };
export const dynamic = "force-dynamic";

const BUCKETS: UsageBucket[] = ["active", "cooling", "idle", "never"];
const TONE: Record<UsageBucket, "gain" | "coin" | "loss" | "neutral"> = { active: "gain", cooling: "coin", idle: "loss", never: "neutral" };
const ICON = { active: "pulse", cooling: "calendar", idle: "down", never: "user" } as const;
// Quem precisa de atenção aparece primeiro
const ORDER: UsageBucket[] = ["never", "idle", "cooling", "active"];

function ago(d: Date | null, now: Date) {
  if (!d) return "nunca";
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (min < 60) return min <= 1 ? "agora há pouco" : `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return "ontem";
  if (days < 60) return `há ${days} dias`;
  return `há ${Math.floor(days / 30)} meses`;
}

/** Em teste grátis e sem usar: provavelmente não vai virar pagante. */
const atRisk = (r: UsageRow) => (r.access === "trial" || r.access === "card_trial") && (r.bucket === "never" || r.bucket === "idle" || r.bucket === "cooling");

export default async function Usage({ searchParams }: { searchParams: Promise<{ f?: string; todos?: string }> }) {
  const admin = await requireAdmin("view_metrics");
  const { f, todos } = await searchParams;
  const all = todos === "1";
  const filter = BUCKETS.includes(f as UsageBucket) ? (f as UsageBucket) : null;
  const now = new Date();

  const base = (await usageOverview(can(admin, "view_pii"), now)).filter((r) => all || (r.access !== null && LIVE_ACCESS.includes(r.access)));
  const count = (b: UsageBucket) => base.filter((r) => r.bucket === b).length;
  const rows = base
    .filter((r) => !filter || r.bucket === filter)
    .sort((a, b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket) || (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0) || b.createdAt.getTime() - a.createdAt.getTime());
  const risk = base.filter(atRisk).length;

  const href = (next: { f?: UsageBucket | null; todos?: boolean }) => {
    const p = new URLSearchParams();
    const nf = next.f === undefined ? filter : next.f;
    const nt = next.todos === undefined ? all : next.todos;
    if (nf) p.set("f", nf);
    if (nt) p.set("todos", "1");
    const s = p.toString();
    return `/admin/uso${s ? `?${s}` : ""}`;
  };
  const pill = (active: boolean) => `inline-flex h-8 items-center rounded-full px-3.5 text-sm font-semibold ${active ? "bg-gain text-white" : "bg-paper text-ink-soft hover:text-gain"}`;

  return (
    <>
      <PageHeader
        title="Uso dos clientes"
        description="Quem está usando o robô no WhatsApp de verdade. Mede só mensagens enviadas e entradas no painel; nenhum lançamento ou valor dos clientes aparece aqui."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {BUCKETS.map((b) => (
          <Link key={b} href={href({ f: filter === b ? null : b })} className={`rounded-[22px] transition ${filter === b ? "ring-2 ring-gain" : ""}`}>
            <Stat icon={ICON[b]} label={USAGE_LABELS[b]} hint={USAGE_HINTS[b]} tone={b === "active" ? "gain" : b === "idle" ? "loss" : "coin"}>
              {count(b)}
            </Stat>
          </Link>
        ))}
      </div>

      {risk > 0 && (
        <p className="mb-5 rounded-[16px] bg-loss-soft px-4 py-3 text-sm text-loss">
          <b>{risk} cliente{risk === 1 ? "" : "s"} em teste grátis {risk === 1 ? "não está" : "não estão"} usando o robô.</b> Vale chamar no WhatsApp antes do teste acabar.
        </p>
      )}

      <div className="-mx-1 mb-4 flex items-center gap-2 overflow-x-auto whitespace-nowrap px-1 pb-1 sm:flex-wrap">
        <Link href={href({ f: null })} className={pill(!filter)}>Todos ({base.length})</Link>
        {BUCKETS.map((b) => (
          <Link key={b} href={href({ f: b })} className={pill(filter === b)}>{USAGE_LABELS[b]} ({count(b)})</Link>
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
        <Link href={href({ todos: !all })} className={pill(all)}>{all ? "Incluindo quem não assinou" : "Só quem tem acesso liberado"}</Link>
      </div>

      {rows.length === 0 ? (
        <Empty title="Ninguém por aqui">{filter ? "Nenhum cliente nesse grupo." : "Nenhum cliente com acesso liberado ainda."}</Empty>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.userId} className="grid gap-3 py-3.5 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.name}</p>
                  <p className="truncate text-xs text-ink-faint">{r.email} · cliente desde {r.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={TONE[r.bucket]}>{USAGE_LABELS[r.bucket]}</Badge>
                    <Badge>{r.plan && r.access ? `${r.plan} · ${ACCESS_LABELS[r.access]}` : "sem assinatura"}</Badge>
                    {!r.whatsappLinked && <Badge tone="coin">WhatsApp não vinculado</Badge>}
                    {atRisk(r) && r.endsAt && <Badge tone="loss">teste acaba {r.endsAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })}</Badge>}
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-ink-faint">7 dias</dt><dd className="money font-semibold">{r.messages7} msg</dd></div>
                  <div><dt className="text-xs text-ink-faint">30 dias</dt><dd className="money font-semibold">{r.messages30} msg</dd></div>
                  <div><dt className="text-xs text-ink-faint">Dias ativos</dt><dd className="money font-semibold">{r.activeDays30}/30</dd></div>
                </dl>
                <div className="text-sm md:text-right">
                  <p>Última mensagem <b className={r.bucket === "active" ? "text-gain" : r.bucket === "idle" ? "text-loss" : ""}>{ago(r.lastMessageAt, now)}</b></p>
                  <p className="text-xs text-ink-faint">Entrou no painel {ago(r.lastLoginAt, now)} · {r.messagesTotal.toLocaleString("pt-BR")} msg no total</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <p className="mt-4 text-xs text-ink-faint">“Entrou no painel” conta o último login no site. Mensagens contam tudo que o cliente mandou para o robô (texto, áudio ou foto de comprovante).</p>
    </>
  );
}
