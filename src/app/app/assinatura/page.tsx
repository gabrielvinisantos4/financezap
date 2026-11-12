import { desc, eq } from "drizzle-orm";
import { appContext } from "@/server/app-context";
import { db } from "@/server/db/client";
import { payments } from "@/server/db/schema";
import { cardTrialFirstCharge, currentSubscription, listActivePlans } from "@/server/billing/subscriptions";
import { getEntitlement, monthlyUsage } from "@/server/billing/entitlements";
import { formatBRL } from "@/server/finance/money";
import { addDays, todayIn } from "@/server/finance/dates";
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

const RETURN_MSG: Record<string, [string, "gain" | "coin"]> = {
  processando: ["Recebemos seus dados no Asaas. Assim que o cartão for aprovado, o acesso é liberado automaticamente — costuma levar poucos segundos. Atualize esta página.", "gain"],
  cancelado: ["Pagamento cancelado. Nenhuma cobrança foi feita. Você pode escolher outro plano ou forma de pagamento abaixo.", "coin"],
  expirado: ["O link de pagamento expirou. Gere um novo abaixo.", "coin"],
  teste: ["Teste grátis liberado! Pode usar à vontade. O primeiro Pix chega no seu e-mail no último dia do teste.", "gain"],
};

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ plano?: string; pagamento?: string }> }) {
  const { plano, pagamento } = await searchParams;
  const { user } = await appContext();
  const [sub, plans, ent, usage, history, trialUntil] = await Promise.all([
    currentSubscription(user.id),
    listActivePlans(),
    getEntitlement(user.id),
    monthlyUsage(user.id),
    db().select().from(payments).where(eq(payments.userId, user.id)).orderBy(desc(payments.createdAt)).limit(12),
    cardTrialFirstCharge(user.id),
  ]);
  const isTrial = sub?.provider === "manual";
  const canBuy = !sub || isTrial || ["canceled", "expired"].includes(sub.status) || (sub.status === "pending" && !ent.active) || (sub.status === "pending" && sub.paymentMethod === "credit_card");
  const notice = pagamento ? RETURN_MSG[pagamento] : undefined;
  const PAID = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
  // Teste grátis com cartão: assinatura no Asaas liberada, mas nenhuma cobrança paga ainda
  const cardTrial = sub?.provider === "asaas" && (sub.paymentMethod === "credit_card" || sub.paymentMethod === "pix") && ["active", "canceled"].includes(sub.status) && !history.some((p) => PAID.includes(p.status));
  const pixTrial = cardTrial && sub?.paymentMethod === "pix";
  const firstCharge = cardTrial ? history.find((p) => p.status === "PENDING")?.dueDate ?? null : null;
  const fmt = (iso: string) => iso.split("-").reverse().join("/");
  // No teste com Pix o link de pagamento só aparece nos 3 últimos dias do teste
  const pixPayFrom = firstCharge ? addDays(firstCharge, -3) : null;
  const pendingInvoice =
    cardTrial && !(pixTrial && pixPayFrom && todayIn(user.timezone) >= pixPayFrom) ? undefined : history.find((p) => p.status === "PENDING" || p.status === "OVERDUE");

  return (
    <>
      <PageHeader title="Assinatura" />
      {notice && <p role="status" className={`mb-6 rounded-xl px-4 py-3 text-sm ${notice[1] === "gain" ? "bg-gain-soft text-gain" : "bg-coin-soft text-ink"}`}>{notice[0]}</p>}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="grid content-start gap-6">
          {sub && (
            <Panel title={`Plano ${sub.plan.name}`} action={<Badge tone={STATUS[sub.status][1]}>{STATUS[sub.status][0]}</Badge>}>
              <p className="money text-lg">{isTrial ? "Período de teste grátis" : `${formatBRL(sub.priceCents)} ${sub.cycle === "monthly" ? "por mês" : "por ano"}${sub.paymentMethod === "credit_card" ? " · cartão de crédito" : sub.paymentMethod === "pix" ? " · Pix" : ""}`}</p>
              {cardTrial ? (
                <p className="mt-1 text-sm text-ink-soft">
                  {sub.status === "canceled"
                    ? `Teste grátis cancelado: você usa até ${sub.currentPeriodEnd?.toLocaleDateString("pt-BR", { timeZone: user.timezone }) ?? "o fim do teste"} e não será cobrado.`
                    : pixTrial
                      ? `Teste grátis em andamento até ${firstCharge ? fmt(firstCharge) : "o fim do teste"}. O primeiro Pix vence nesse dia — se não for pago, o acesso pausa no dia seguinte.`
                      : `Teste grátis em andamento. A primeira cobrança no cartão é em ${firstCharge ? fmt(firstCharge) : sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd.getTime() - 86400_000).toLocaleDateString("pt-BR", { timeZone: user.timezone }) : "breve"}. Cancele antes disso e não paga nada.`}
                </p>
              ) : (
                sub.currentPeriodEnd && <p className="mt-1 text-sm text-ink-soft">{sub.status === "canceled" ? "Acesso até" : isTrial ? "Teste grátis até" : "Período pago até"} {sub.currentPeriodEnd.toLocaleDateString("pt-BR", { timeZone: user.timezone })}</p>
              )}
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
                  <p className="my-3 text-sm text-ink-soft">{cardTrial ? "Você continua usando até o fim do teste e nenhuma cobrança é feita." : "Você continua com acesso até o fim do período pago."} Seus dados ficam disponíveis no painel até você excluir a conta.</p>
                  <ActionForm action={cancelSubscriptionAction}>
                    <Submit className="btn btn-danger w-fit" pendingText="Cancelando…">Confirmar cancelamento</Submit>
                  </ActionForm>
                </details>
              )}
            </Panel>
          )}
          {canBuy && (
            <Panel title={isTrial ? "Cadastre o cartão para continuar depois do teste" : trialUntil ? "Comece seu teste grátis" : sub && sub.status !== "pending" ? "Assinar novamente" : "Escolha seu plano"}>
              {!integrations.asaasConfigured() ? (
                <p className="text-sm text-ink-soft">Os pagamentos ainda não foram ativados nesta instalação.</p>
              ) : plans.length === 0 ? (
                <p className="text-sm text-ink-soft">Nenhum plano disponível no momento.</p>
              ) : (
                <CheckoutForm
                  initial={plano}
                  trialUntil={trialUntil ? fmt(trialUntil) : null}
                  pixTrialUntil={trialUntil ? fmt(addDays(trialUntil, -1) > todayIn(user.timezone) ? addDays(trialUntil, -1) : trialUntil) : null}
                  plans={plans.map((p) => {
                    const saving = p.priceMonthlyCents * 12 - p.priceYearlyCents;
                    return {
                      slug: p.slug,
                      name: p.name,
                      description: p.description,
                      monthly: formatBRL(p.priceMonthlyCents),
                      yearly: formatBRL(p.priceYearlyCents),
                      yearlySavings: saving > 0 ? `Economize ${formatBRL(saving)} por ano` : null,
                      features: p.features,
                    };
                  })}
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
