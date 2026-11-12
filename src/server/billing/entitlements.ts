import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { payments, plans, subscriptions, usageEvents, users, type PlanLimits } from "../db/schema";
import { env } from "../config/env";

export type Entitlement =
  | { active: true; planSlug: string; planName: string; limits: PlanLimits; subscriptionId: string; status: string }
  | { active: false; reason: "no_subscription" | "pending_payment" | "past_due" | "canceled" | "blocked" | "deleted" };

/** Decide se o cliente pode usar o produto agora, considerando assinatura e tolerância. */
export async function getEntitlement(userId: string, now: Date = new Date()): Promise<Entitlement> {
  const [u] = await db().select({ status: users.status }).from(users).where(eq(users.id, userId));
  if (!u) return { active: false, reason: "deleted" };
  if (u.status === "blocked") return { active: false, reason: "blocked" };
  if (u.status === "deleted") return { active: false, reason: "deleted" };

  const rows = await db()
    .select({ s: subscriptions, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(5);
  if (!rows.length) return { active: false, reason: "no_subscription" };

  const graceMs = env().BILLING_GRACE_DAYS * 86400_000;
  for (const { s, p } of rows) {
    const inGrace = s.graceUntil !== null && s.graceUntil > now;
    // Assinatura ativa ganha a tolerância configurada após o fim do período,
    // cobrindo o intervalo entre o vencimento e a chegada do webhook de atraso.
    // Teste/cortesia manual não tem tolerância: acaba no fim do período
    const tolerance = s.provider === "manual" ? 0 : graceMs;
    let periodOk = s.currentPeriodEnd === null || s.currentPeriodEnd.getTime() + tolerance > now.getTime() || inGrace;
    // Teste grátis no Pix que nunca foi pago: trava logo após o fim do teste, sem tolerância
    if (periodOk && !inGrace && s.status === "active" && s.provider === "asaas" && s.paymentMethod === "pix" && s.currentPeriodEnd && s.currentPeriodEnd <= now) {
      const [paid] = await db()
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.subscriptionId, s.id), inArray(payments.status, ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"])))
        .limit(1);
      if (!paid) periodOk = false;
    }
    if ((s.status === "active" && periodOk) || (s.status === "past_due" && inGrace) || (s.status === "canceled" && s.currentPeriodEnd && s.currentPeriodEnd > now)) {
      return { active: true, planSlug: p.slug, planName: p.name, limits: p.limits, subscriptionId: s.id, status: s.status };
    }
  }
  const latest = rows[0].s;
  if (latest.status === "pending") return { active: false, reason: "pending_payment" };
  if (latest.status === "past_due") return { active: false, reason: "past_due" };
  // Só tentativas que nunca foram liberadas (ex.: pagamento não concluído): ainda não assinou
  if (rows.every(({ s }) => s.status === "expired" && s.currentPeriodEnd === null)) return { active: false, reason: "no_subscription" };
  return { active: false, reason: "canceled" };
}

export function startOfMonthUtc(now: Date = new Date()): Date {
  // Mês comercial no fuso de São Paulo (UTC-3, sem horário de verão desde 2019)
  const sp = new Date(now.getTime() - 3 * 3600_000);
  return new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), 1, 3, 0, 0));
}

export async function monthlyUsage(userId: string, now: Date = new Date()) {
  const rows = await db()
    .select({ type: usageEvents.type, total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, startOfMonthUtc(now)), inArray(usageEvents.type, ["wa_inbound", "ai_call"])))
    .groupBy(usageEvents.type);
  return {
    messages: rows.find((r) => r.type === "wa_inbound")?.total ?? 0,
    aiCalls: rows.find((r) => r.type === "ai_call")?.total ?? 0,
  };
}

export async function recordUsage(input: { userId: string | null; type: "ai_call" | "wa_inbound" | "wa_outbound"; tokensIn?: number; tokensOut?: number; costMicroUsd?: number; model?: string }) {
  await db().insert(usageEvents).values({
    userId: input.userId,
    type: input.type,
    tokensIn: input.tokensIn ?? null,
    tokensOut: input.tokensOut ?? null,
    costMicroUsd: Math.round(input.costMicroUsd ?? 0),
    model: input.model ?? null,
  });
}

export const INACTIVE_MESSAGES: Record<Exclude<Entitlement, { active: true }>["reason"], string> = {
  no_subscription: "Sua conta ainda não está ativa. Comece seu teste grátis de 15 dias (sem pagar nada agora) em: ",
  pending_payment: "Estamos aguardando a confirmação do seu pagamento. Assim que o pagamento for confirmado, seu acesso é liberado automaticamente. Acompanhe em: ",
  past_due: "Sua assinatura está com pagamento em atraso e o acesso foi pausado. Regularize em: ",
  canceled: "Sua assinatura foi encerrada. Para voltar a usar, reative em: ",
  blocked: "Seu acesso está temporariamente suspenso. Fale com o suporte pelo painel: ",
  deleted: "Esta conta não está mais ativa.",
};
