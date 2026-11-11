import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { billingEvents, payments, plans, subscriptions, users, type Plan, type Subscription } from "../db/schema";
import { env } from "../config/env";
import { safeEqual } from "../security/crypto";
import { addDays, addMonths, todayIn } from "../finance/dates";
import { FinanceError } from "../finance/errors";
import { opEvent } from "../ops/events";
import { asaas, AsaasError, checkoutUrl, type AsaasPayment } from "./asaas";

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
  method: z.enum(["pix", "credit_card"], { errorMap: () => ({ message: "Escolha Pix ou cartão" }) }),
  // CPF/CNPJ é exigido pelo Asaas para emitir cobranças. É repassado ao gateway
  // e NÃO é armazenado no nosso banco.
  cpfCnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 11 || v.length === 14, "CPF ou CNPJ inválido"),
});

export type CheckoutResult = { redirectUrl: string | null; subscriptionId: string };

/** Data/hora no fuso de São Paulo no formato que o Asaas Checkout espera. */
function spDateTime(now = new Date()) {
  const sp = new Date(now.getTime() - 3 * 3600_000);
  return sp.toISOString().slice(0, 19).replace("T", " ");
}

async function ensureAsaasCustomer(userId: string, cpfCnpj: string): Promise<string> {
  const [existing] = await db()
    .select({ id: subscriptions.providerCustomerId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.provider, "asaas")))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  if (existing?.id) return existing.id;
  const found = await asaas.findCustomerByExternalReference(userId).catch(() => ({ data: [] as { id: string }[] }));
  if (found.data[0]) return found.data[0].id;
  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user) throw new FinanceError("not_found", "Usuário não encontrado.");
  const c = await asaas.createCustomer({ name: user.name, email: user.email, cpfCnpj, mobilePhone: user.phoneE164?.replace(/^55/, "") ?? null, externalReference: user.id });
  return c.id;
}

/**
 * Teste grátis com cartão: devolve a data (YYYY-MM-DD, São Paulo) da 1ª cobrança
 * quando o cliente tem direito a ela, ou null para cobrar já.
 *  - teste/cortesia manual em andamento: a cobrança começa quando ele acabar;
 *  - nunca teve assinatura liberada: CARD_TRIAL_DAYS dias a partir de hoje;
 *  - já usou teste ou já assinou antes: sem teste.
 */
export async function cardTrialFirstCharge(userId: string, now = new Date()): Promise<string | null> {
  const today = todayIn("America/Sao_Paulo", now);
  const rows = await db().select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const manual = rows.find((s) => s.provider === "manual" && s.status === "active" && s.currentPeriodEnd && s.currentPeriodEnd > now);
  if (manual?.currentPeriodEnd) {
    const end = todayIn("America/Sao_Paulo", manual.currentPeriodEnd);
    return end > today ? end : null;
  }
  const days = env().CARD_TRIAL_DAYS;
  if (days <= 0) return null;
  const hadAccess = rows.some((s) => s.provider === "manual" || s.providerSubscriptionId !== null);
  return hadAccess ? null : addDays(today, days);
}

/** Libera o teste quando o Asaas confirma que o cartão foi cadastrado e a 1ª cobrança é futura. */
async function startCardTrial(sub: Subscription, firstDueDate: string | null | undefined) {
  if (sub.status !== "pending" || sub.paymentMethod !== "credit_card" || !firstDueDate) return;
  if (firstDueDate <= todayIn("America/Sao_Paulo")) return;
  const periodEnd = new Date(`${addDays(firstDueDate, 1)}T03:00:00Z`);
  await db().update(subscriptions).set({ status: "active", currentPeriodEnd: periodEnd, graceUntil: null }).where(and(eq(subscriptions.id, sub.id), eq(subscriptions.status, "pending")));
  await db()
    .update(subscriptions)
    .set({ status: "expired", currentPeriodEnd: new Date() })
    .where(and(eq(subscriptions.userId, sub.userId), eq(subscriptions.provider, "manual"), eq(subscriptions.status, "active")));
  await opEvent("info", "billing.trial_started", "Teste grátis iniciado com cartão cadastrado", { firstDueDate }, sub.userId);
}

export async function startCheckout(userId: string, input: z.infer<typeof checkoutSchema>): Promise<CheckoutResult> {
  const plan = await getPlanBySlug(input.planSlug);
  if (!plan || !plan.active) throw new FinanceError("invalid", "Plano indisponível.");
  const price = input.cycle === "monthly" ? plan.priceMonthlyCents : plan.priceYearlyCents;
  if (price <= 0) throw new FinanceError("invalid", "Este plano ainda não tem preço configurado.");

  // Assinatura paga em andamento bloqueia nova compra; cortesia/teste não bloqueia
  const current = await currentSubscription(userId);
  if (current && current.provider !== "manual" && (current.status === "active" || current.status === "past_due") && current.currentPeriodEnd && current.currentPeriodEnd > new Date()) {
    throw new FinanceError("conflict", "Você já tem uma assinatura ativa. Cancele a atual para trocar de plano.");
  }

  const [user] = await db().select().from(users).where(eq(users.id, userId));
  if (!user) throw new FinanceError("not_found", "Usuário não encontrado.");

  // Tentativa anterior nunca paga: cancela no gateway para não deixar cobrança órfã
  const pendings = await db().select().from(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "pending")));
  for (const p of pendings) {
    if (p.providerSubscriptionId) await asaas.cancelSubscription(p.providerSubscriptionId).catch(() => undefined);
    if (p.providerCheckoutId) await asaas.cancelCheckout(p.providerCheckoutId).catch(() => undefined);
    await db().update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.id, p.id));
  }

  let customerId: string;
  try {
    customerId = await ensureAsaasCustomer(userId, input.cpfCnpj);
  } catch (err) {
    await opEvent("error", "billing.customer_failed", "Falha ao cadastrar cliente no Asaas", { error: String((err as Error).message).slice(0, 300) }, userId);
    throw new FinanceError("invalid", "Não foi possível iniciar o pagamento. Confira o CPF/CNPJ e tente novamente.");
  }

  // Assinatura local primeiro (pending): o id dela vai como externalReference
  const [sub] = await db()
    .insert(subscriptions)
    .values({ userId, planId: plan.id, cycle: input.cycle, status: "pending", priceCents: price, provider: "asaas", providerCustomerId: customerId, paymentMethod: input.method })
    .returning();

  const cycle = input.cycle === "monthly" ? "MONTHLY" : "YEARLY";
  const label = `${env().APP_NAME} ${plan.name} (${input.cycle === "monthly" ? "mensal" : "anual"})`;
  try {
    if (input.method === "pix") {
      const remote = await asaas.createPixSubscription({
        customer: customerId,
        value: price / 100,
        nextDueDate: todayIn(user.timezone),
        cycle,
        description: label,
        externalReference: sub.id,
      });
      await db().update(subscriptions).set({ providerSubscriptionId: remote.id }).where(eq(subscriptions.id, sub.id));
      const list = await asaas.listSubscriptionPayments(remote.id).catch(() => ({ data: [] as AsaasPayment[] }));
      const first = list.data[0];
      if (first) await upsertPayment(userId, sub.id, first);
      return { redirectUrl: first?.invoiceUrl ?? null, subscriptionId: sub.id };
    }

    const back = `${env().APP_URL}/app/assinatura`;
    const trialUntil = await cardTrialFirstCharge(userId);
    const checkout = await asaas.createRecurringCardCheckout({
      customer: customerId,
      value: price / 100,
      cycle,
      nextDueDate: trialUntil ? `${trialUntil} 12:00:00` : spDateTime(),
      itemName: `Plano ${plan.name}`,
      itemDescription: label,
      externalReference: sub.id,
      successUrl: `${back}?pagamento=processando`,
      cancelUrl: `${back}?pagamento=cancelado`,
      expiredUrl: `${back}?pagamento=expirado`,
    });
    await db().update(subscriptions).set({ providerCheckoutId: checkout.id }).where(eq(subscriptions.id, sub.id));
    return { redirectUrl: checkoutUrl(checkout.id, checkout.link), subscriptionId: sub.id };
  } catch (err) {
    await db().update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.id, sub.id));
    await opEvent("error", "billing.checkout_failed", "Falha ao iniciar pagamento no Asaas", { method: input.method, error: String((err as Error).message).slice(0, 300) }, userId);
    if (err instanceof AsaasError) throw new FinanceError("invalid", "Não foi possível iniciar o pagamento agora. Tente novamente em instantes.");
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
    subscription: z.object({ id: z.string(), customer: z.string().nullish(), externalReference: z.string().nullish(), status: z.string().optional(), deleted: z.boolean().optional() }).passthrough().optional(),
    checkout: z.object({ id: z.string(), customer: z.string().nullish(), status: z.string().nullish() }).passthrough().optional(),
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Encontra a assinatura local de uma assinatura do Asaas. Assinaturas por cartão
 * nascem no Asaas Checkout, então na primeira notificação ainda não sabemos o id:
 * vinculamos pelo externalReference (id local) ou pelo cliente + checkout pendente.
 */
async function findSubscriptionByProviderId(providerSubscriptionId: string, hint: { customer?: string | null; externalReference?: string | null } = {}) {
  const [s] = await db().select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId));
  if (s) return s;

  let customer = hint.customer ?? null;
  let externalReference = hint.externalReference ?? null;
  if (env().ASAAS_API_KEY && (!customer || !externalReference)) {
    const remote = await asaas.getSubscription(providerSubscriptionId).catch(() => null);
    customer ??= remote?.customer ?? null;
    externalReference ??= remote?.externalReference ?? null;
  }

  let local: Subscription | null = null;
  if (externalReference && UUID_RE.test(externalReference)) {
    const [byRef] = await db().select().from(subscriptions).where(and(eq(subscriptions.id, externalReference), isNull(subscriptions.providerSubscriptionId)));
    local = byRef ?? null;
  }
  if (!local && customer) {
    const [byCustomer] = await db()
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.providerCustomerId, customer), eq(subscriptions.status, "pending"), isNull(subscriptions.providerSubscriptionId), isNotNull(subscriptions.providerCheckoutId)))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    local = byCustomer ?? null;
  }
  if (!local) return null;
  const [linked] = await db().update(subscriptions).set({ providerSubscriptionId }).where(eq(subscriptions.id, local.id)).returning();
  await opEvent("info", "billing.subscription_linked", "Assinatura do Asaas vinculada", { method: local.paymentMethod }, local.userId);
  return linked;
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
    const sub = await findSubscriptionByProviderId(subId, { customer: ev.payment.customer });
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
      // O plano pago substitui o período de teste/cortesia
      await db()
        .update(subscriptions)
        .set({ status: "expired", currentPeriodEnd: new Date() })
        .where(and(eq(subscriptions.userId, sub.userId), eq(subscriptions.provider, "manual"), eq(subscriptions.status, "active")));
      if (sub.status !== "active") await opEvent("info", "billing.activated", "Assinatura ativada/regularizada por pagamento confirmado", { plan: sub.planId }, sub.userId);
    } else if (ev.event === "PAYMENT_CREATED") {
      // 1ª cobrança do cartão marcada para depois do teste: o cartão já foi validado
      await startCardTrial(sub, payment.dueDate);
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
  if (ev.checkout) {
    if (ev.event === "CHECKOUT_EXPIRED" || ev.event === "CHECKOUT_CANCELED") {
      await db()
        .update(subscriptions)
        .set({ status: "expired" })
        .where(and(eq(subscriptions.providerCheckoutId, ev.checkout.id), eq(subscriptions.status, "pending"), isNull(subscriptions.providerSubscriptionId)));
    }
    return;
  }
  if (ev.subscription) {
    const sub = await findSubscriptionByProviderId(ev.subscription.id, { customer: ev.subscription.customer, externalReference: ev.subscription.externalReference });
    if (!sub) return;
    if (ev.event === "SUBSCRIPTION_CREATED" && sub.status === "pending" && sub.paymentMethod === "credit_card") {
      // Confirma no Asaas (não confia só no corpo do evento)
      const remote = env().ASAAS_API_KEY ? await asaas.getSubscription(ev.subscription.id).catch(() => null) : null;
      if (remote && remote.status === "ACTIVE" && !remote.deleted) await startCardTrial(sub, remote.nextDueDate?.slice(0, 10));
      return;
    }
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
