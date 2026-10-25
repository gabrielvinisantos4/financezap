import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { billingEvents, payments, plans, subscriptions, users, type Plan, type Subscription } from "../db/schema";
import { env } from "../config/env";
import { safeEqual } from "../security/crypto";
import { addDays, addMonths, todayIn } from "../finance/dates";
import { FinanceError } from "../finance/errors";
import { opEvent } from "../ops/events";
import { asaas, AsaasError, type AsaasPayment } from "./asaas";

export async function listActivePlans(): Promise<Plan[]> {
  return db().select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder));
}

export async function getPlanBySlug(slug: string): Promise<Plan | null> {
  const [p] = await db().select().from(plans).where(eq(plans.slug, slug));
  return p ?? null;
}

export async function currentSubscription(userId: string): Promise<(Subscription & { plan: Plan }) | null> {
  const [row] = await db()
    .select({ s: subscriptions, p: plans })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row ? { ...row.s, plan: row.p } : null;
}

/* ------------------------------------------------------------------ */
/* Checkout                                                             */
/* ------------------------------------------------------------------ */
export const checkoutSchema = z.object({
  planSlug: z.string().min(1).max(40),
  cycle: z.enum(["monthly", "yearly"]),
  // CPF/CNPJ é exigido pelo Asaas para emitir cobranças. É repassado ao gateway
  // e NÃO é armazenado no nosso banco.
  cpfCnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 11 || v.length === 14, "CPF ou CNPJ inválido"),
});

export async function startCheckout(userId: string, input: z.infer<typeof checkoutSchema>): Promise<{ invoiceUrl: string | null; subscriptionId: string }> {
  const plan = await getPlanBySlug(input.planSlug);
  if (!plan || !plan.active) throw new FinanceError("invalid", "Plano indisponível.");
  const price = input.cycle === "monthly" ? plan.priceMonthlyCents : plan.priceYearlyCents;
  if (price <= 0) throw new FinanceError("invalid", "Este plano ainda não tem preço configurado.");

  const current = await currentSubscription(userId);
  if (current && (current.status === "active" || current.status === "past_due") && current.currentPeriodEnd && current.currentPeriodEnd > new Date()) {
    throw new FinanceError("conflict", "Você já tem uma assinatura ativa. Cancele a atual para trocar de plano.");
  }

  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user) throw new FinanceError("not_found", "Usuário não encontrado.");

  // Checkout anterior nunca pago: cancela no gateway para não deixar cobrança órfã
  if (current?.status === "pending" && current.providerSubscriptionId) {
    await asaas.cancelSubscription(current.providerSubscriptionId).catch(() => undefined);
    await db().update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.id, current.id));
  }

  let customerId = current?.providerCustomerId ?? null;
  if (!customerId) {
    const c = await asaas.createCustomer({ name: user.name, email: user.email, cpfCnpj: input.cpfCnpj, mobilePhone: user.phoneE164?.replace(/^55/, "") ?? null, externalReference: user.id });
    customerId = c.id;
  }

  // Cria a assinatura local primeiro (pending) para usar o id como externalReference
  const [sub] = await db()
    .insert(subscriptions)
    .values({ userId, planId: plan.id, cycle: input.cycle, status: "pending", priceCents: price, provider: "asaas", providerCustomerId: customerId })
    .returning();

  try {
    const remote = await asaas.createSubscription({
      customer: customerId,
      value: price / 100,
      nextDueDate: todayIn(user.timezone),
      cycle: input.cycle === "monthly" ? "MONTHLY" : "YEARLY",
      description: `${env().APP_NAME} — plano ${plan.name} (${input.cycle === "monthly" ? "mensal" : "anual"})`,
      externalReference: sub.id,
    });
    await db().update(subscriptions).set({ providerSubscriptionId: remote.id }).where(eq(subscriptions.id, sub.id));
    const list = await asaas.listSubscriptionPayments(remote.id).catch(() => ({ data: [] as AsaasPayment[] }));
    const first = list.data[0];
    if (first) await upsertPayment(userId, sub.id, first);
    return { invoiceUrl: first?.invoiceUrl ?? null, subscriptionId: sub.id };
  } catch (err) {
    await db().update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.id, sub.id));
    await opEvent("error", "billing.checkout_failed", "Falha ao criar assinatura no Asaas", { error: String((err as Error).message).slice(0, 300) }, userId);
    if (err instanceof AsaasError) throw new FinanceError("invalid", "Não foi possível iniciar o pagamento. Confira o CPF/CNPJ e tente novamente.");
    throw err;
  }
}

export async function cancelSubscription(userId: string): Promise<void> {
  const current = await currentSubscription(userId);
  if (!current || current.status === "canceled" || current.status === "expired") throw new FinanceError("invalid", "Não há assinatura ativa para cancelar.");
  if (current.providerSubscriptionId && current.provider === "asaas") {
    await asaas.cancelSubscription(current.providerSubscriptionId);
  }
  // Acesso continua até o fim do período já pago
  await db().update(subscriptions).set({ status: "canceled", canceledAt: new Date() }).where(eq(subscriptions.id, current.id));
  await opEvent("info", "billing.canceled_by_user", "Assinatura cancelada pelo cliente", undefined, userId);
}

/** Cortesia/manual (admin): libera acesso sem gateway, por N dias. */
export async function grantManualSubscription(userId: string, planSlug: string, days: number) {
  const plan = await getPlanBySlug(planSlug);
  if (!plan) throw new FinanceError("not_found", "Plano não encontrado.");
  const [row] = await db()
    .insert(subscriptions)
    .values({ userId, planId: plan.id, cycle: "monthly", status: "active", priceCents: 0, provider: "manual", currentPeriodEnd: new Date(Date.now() + days * 86400_000) })
    .returning();
  return row;
}

/* ------------------------------------------------------------------ */
/* Webhook do Asaas                                                     */
/* ------------------------------------------------------------------ */
const asaasEventSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().min(1),
    payment: z
      .object({ id: z.string(), customer: z.string(), subscription: z.string().nullish(), status: z.string(), value: z.number(), dueDate: z.string().nullish(), invoiceUrl: z.string().nullish(), billingType: z.string().nullish(), paymentDate: z.string().nullish(), confirmedDate: z.string().nullish(), externalReference: z.string().nullish() })
      .passthrough()
      .optional(),
    subscription: z.object({ id: z.string(), status: z.string().optional(), deleted: z.boolean().optional() }).passthrough().optional(),
  })
  .passthrough();

export function verifyAsaasToken(header: string | null): boolean {
  const expected = env().ASAAS_WEBHOOK_TOKEN;
  return Boolean(expected && header && safeEqual(header, expected));
}

/**
 * Registra o evento uma única vez (id do evento é chave única) e aplica.
 * O status do pagamento é reconfirmado na API do Asaas antes de liberar acesso:
 * nunca liberamos acesso por comprovante enviado pelo cliente.
 */
export async function handleAsaasWebhook(rawBody: string, token: string | null): Promise<{ status: 200 | 401 | 400; duplicate?: boolean }> {
  if (!verifyAsaasToken(token)) {
    await opEvent("warn", "billing.webhook_invalid_token", "Webhook do Asaas com token inválido");
    return { status: 401 };
  }
  let parsed;
  try {
    parsed = asaasEventSchema.safeParse(JSON.parse(rawBody));
  } catch {
    return { status: 400 };
  }
  if (!parsed.success) return { status: 400 };
  const ev = parsed.data;

  const inserted = await db()
    .insert(billingEvents)
    .values({ provider: "asaas", providerEventId: ev.id, type: ev.event, payload: ev })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });
  if (!inserted.length) return { status: 200, duplicate: true };

  try {
    await applyAsaasEvent(ev);
    await db().update(billingEvents).set({ processedAt: new Date() }).where(eq(billingEvents.id, inserted[0].id));
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 500);
    await db().update(billingEvents).set({ error: msg }).where(eq(billingEvents.id, inserted[0].id));
    await opEvent("error", "billing.webhook_failed", "Falha ao aplicar evento do Asaas", { event: ev.event, error: msg });
    // Remove o registro para que a nova tentativa do Asaas seja reprocessada
    await db().delete(billingEvents).where(eq(billingEvents.id, inserted[0].id));
    throw err;
  }
  return { status: 200 };
}

async function findSubscriptionByProviderId(providerSubscriptionId: string) {
  const [s] = await db().select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
  return s ?? null;
}

async function upsertPayment(userId: string, subscriptionId: string | null, p: AsaasPayment) {
  const paidAt = p.paymentDate ?? p.confirmedDate ?? null;
  await db()
    .insert(payments)
    .values({
      userId,
      subscriptionId,
      providerPaymentId: p.id,
      status: p.status,
      valueCents: Math.round(p.value * 100),
      billingType: p.billingType ?? null,
      dueDate: p.dueDate ?? null,
      paidAt: paidAt ? new Date(`${paidAt}T12:00:00Z`) : null,
      invoiceUrl: p.invoiceUrl ?? null,
    })
    .onConflictDoUpdate({
      target: payments.providerPaymentId,
      set: { status: p.status, paidAt: paidAt ? new Date(`${paidAt}T12:00:00Z`) : null, invoiceUrl: p.invoiceUrl ?? null, valueCents: Math.round(p.value * 100) },
    });
}

const PAID = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

async function applyAsaasEvent(ev: z.infer<typeof asaasEventSchema>) {
  if (ev.payment) {
    const subId = ev.payment.subscription;
    if (!subId) return; // cobrança avulsa: não é deste produto
    const sub = await findSubscriptionByProviderId(subId);
    if (!sub) {
      await opEvent("warn", "billing.unknown_subscription", "Evento de pagamento para assinatura desconhecida", { event: ev.event });
      return;
    }
    // Defesa em profundidade: confirma o estado real do pagamento no Asaas
    let payment: AsaasPayment = ev.payment as AsaasPayment;
    if (env().ASAAS_API_KEY) payment = await asaas.getPayment(ev.payment.id);
    if (payment.subscription && payment.subscription !== subId) throw new Error("Pagamento não pertence à assinatura informada");
    await upsertPayment(sub.userId, sub.id, payment);

    const graceMs = env().BILLING_GRACE_DAYS * 86400_000;
    if ((ev.event === "PAYMENT_CONFIRMED" || ev.event === "PAYMENT_RECEIVED") && PAID.has(payment.status)) {
      const base = payment.dueDate ?? todayIn("America/Sao_Paulo");
      const end = sub.cycle === "yearly" ? addMonths(base, 12) : addMonths(base, 1);
      const periodEnd = new Date(`${addDays(end, 1)}T03:00:00Z`); // fim do dia em São Paulo
      // Não reativa assinatura cancelada pelo cliente, mas estende o período pago
      const status = sub.status === "canceled" ? "canceled" : "active";
      await db().update(subscriptions).set({ status, currentPeriodEnd: periodEnd, graceUntil: null }).where(eq(subscriptions.id, sub.id));
      if (sub.status !== "active") await opEvent("info", "billing.activated", "Assinatura ativada/regularizada por pagamento confirmado", { plan: sub.planId }, sub.userId);
    } else if (ev.event === "PAYMENT_OVERDUE") {
      if (sub.status === "active" || sub.status === "pending") {
        await db()
          .update(subscriptions)
          .set({ status: sub.status === "pending" ? "pending" : "past_due", graceUntil: sub.status === "active" ? new Date(Date.now() + graceMs) : null })
          .where(eq(subscriptions.id, sub.id));
        await opEvent("warn", "billing.overdue", "Pagamento em atraso", undefined, sub.userId);
      }
    } else if (["PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE", "PAYMENT_DELETED"].includes(ev.event)) {
      // Estorno/chargeback: se era o pagamento que liberou o período atual, suspende
      if (sub.status === "active" && ev.event !== "PAYMENT_DELETED") {
        await db().update(subscriptions).set({ status: "past_due", graceUntil: null, currentPeriodEnd: new Date() }).where(eq(subscriptions.id, sub.id));
        await opEvent("warn", "billing.refund_or_chargeback", `Evento ${ev.event}`, undefined, sub.userId);
      }
    }
    return;
  }
  if (ev.subscription) {
    const sub = await findSubscriptionByProviderId(ev.subscription.id);
    if (!sub) return;
    if (ev.event === "SUBSCRIPTION_DELETED" || ev.event === "SUBSCRIPTION_INACTIVATED") {
      if (sub.status !== "canceled" && sub.status !== "expired") {
        await db().update(subscriptions).set({ status: "canceled", canceledAt: new Date() }).where(eq(subscriptions.id, sub.id));
      }
    }
  }
}

/** Rotina: encerra assinaturas canceladas/vencidas cujo período acabou. */
export async function expireSubscriptions(now = new Date()) {
  const rows = await db()
    .select()
    .from(subscriptions)
    .where(inArray(subscriptions.status, ["canceled", "past_due"]));
  let n = 0;
  for (const s of rows) {
    const periodOver = !s.currentPeriodEnd || s.currentPeriodEnd <= now;
    const graceOver = !s.graceUntil || s.graceUntil <= now;
    if (periodOver && graceOver && s.status === "canceled") {
      await db().update(subscriptions).set({ status: "expired" }).where(and(eq(subscriptions.id, s.id), eq(subscriptions.status, "canceled")));
      n++;
    }
  }
  return n;
}
