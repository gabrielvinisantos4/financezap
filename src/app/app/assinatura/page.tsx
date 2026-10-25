import { desc, eq } from "drizzle-orm";
import { appContext } from "@/server/app-context";
import { db } from "@/server/db/client";
import { payments } from "@/server/db/schema";
import { currentSubscription, listActivePlans } from "@/server/billing/subscriptions";
import { getEntitlement, monthlyUsage } from "@/server/billing/entitlements";
import { formatBRL } from "@/server/finance/money";
import { integrations } from "@/server/config/env";
import { Badge, Money, PageHeader, Panel } from "@/components/ui";
import { CheckoutForm } from "@/components/checkout-form";
import { ActionForm, Submit } from "@/components/forms";
import { cancelSubscriptionAction } from "@/app/actions/app";

export const metadata = { title: "Assinatura" };

const STATUS: Record<string, [string, "gain" | "loss" | "coin" | "neutral"]> = {
  active: ["Ativa", "gain"],
  pending: ["Aguardando pagamento", "coin"],
  past_due: ["Pagamento em atraso", "loss"],
  canceled: ["Cancelada", "neutral"],
  expired: ["Encerrada", "neutral"],
};
const PAY: Record<string, string> = { PENDING: "Aguardando", RECEIVED: "Pago", CONFIRMED: "Confirmado", OVERDUE: "Vencido", REFUNDED: "Estornado", RECEIVED_IN_CASH: "Pago" };

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ plano?: string }> }) {
  const { plano } = await searchParams;
  const { user } = await appContext();
  const [sub, plans, ent, usage, history] = await Promise.all([
    currentSubscription(user.id),
    listActivePlans(),
    getEntitlement(user.id),
    monthlyUsage(user.id),
    db().select().from(payments).where(eq(payments.userId, user.id)).orderBy(desc(payments.createdAt)).limit(12),
  ]);
  const canBuy = !sub || ["canceled", "expired"].includes(sub.status) || (sub.status === "pending" && !ent.active);
  const pendingInvoice = history.find((p) => p.status === "PENDING" || p.status === "OVERDUE");

  return (
    <>
      <PageHeader title="Assinatura" />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-6">
          {sub && (
            <Panel title={`Plano ${sub.plan.name}`} action={<Badge tone={STATUS[sub.status][1]}>{STATUS[sub.status][0]}</Badge>}>
              <p className="money text-lg">{formatBRL(sub.priceCents)} {sub.cycle === "monthly" ? "por mês" : "por ano"}{sub.provider === "manual" ? " · cortesia" : ""}</p>
              {sub.currentPeriodEnd && <p className="mt-1 text-sm text-ink-soft">{sub.status === "canceled" ? "Acesso até" : "Período pago até"} {sub.currentPeriodEnd.toLocaleDateString("pt-BR", { timeZone: user.timezone })}</p>}
              {pendingInvoice?.invoiceUrl && (
                <a href={pendingInvoice.invoiceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-coin mt-4">
                  Pagar fatura de <Money cents={pendingInvoice.valueCents} />
                </a>
              )}
              {ent.active && (
                <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
                  <div><dt className="text-ink-faint">Mensagens neste mês</dt><dd className="money">{usage.messages} de {ent.limits.monthlyMessages}</dd></div>
                  <div><dt className="text-ink-faint">Interpretações por IA</dt><dd className="money">{usage.aiCalls} de {ent.limits.monthlyAiCalls}</dd></div>
                </dl>
              )}
              {(sub.status === "active" || sub.status === "past_due") && sub.provider === "asaas" && (
                <details className="mt-5 border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm font-semibold">Cancelar assinatura</summary>
                  <p className="my-3 text-sm text-ink-soft">Você continua com acesso até o fim do período pago. Seus dados ficam disponíveis no painel até você excluir a conta.</p>
                  <ActionForm action={cancelSubscriptionAction}>
                    <Submit className="btn btn-danger w-fit" pendingText="Cancelando…">Confirmar cancelamento</Submit>
                  </ActionForm>
                </details>
              )}
            </Panel>
          )}
          {canBuy && (
            <Panel title={sub ? "Assinar novamente" : "Escolha seu plano"}>
              {!integrations.asaasConfigured() ? (
                <p className="text-sm text-ink-soft">Os pagamentos ainda não foram ativados nesta instalação.</p>
              ) : plans.length === 0 ? (
                <p className="text-sm text-ink-soft">Nenhum plano disponível no momento.</p>
              ) : (
                <CheckoutForm
                  initial={plano}
                  plans={plans.map((p) => ({ slug: p.slug, name: p.name, monthly: formatBRL(p.priceMonthlyCents), yearly: formatBRL(p.priceYearlyCents), features: p.features }))}
                />
              )}
            </Panel>
          )}
        </div>
        <Panel title="Pagamentos">
          {history.length === 0 ? (
            <p className="text-sm text-ink-soft">Nenhuma cobrança ainda.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {history.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                  <span>{p.dueDate ? p.dueDate.split("-").reverse().join("/") : "—"} · {PAY[p.status] ?? p.status}</span>
                  {p.invoiceUrl ? <a href={p.invoiceUrl} target="_blank" rel="noopener noreferrer" className="money underline"><Money cents={p.valueCents} /></a> : <Money cents={p.valueCents} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
