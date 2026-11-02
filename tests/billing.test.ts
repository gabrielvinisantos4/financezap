import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/server/db/client";
import { billingEvents, plans, subscriptions } from "@/server/db/schema";
import { cancelSubscription, grantManualSubscription, handleAsaasWebhook, startCheckout } from "@/server/billing/subscriptions";
import { getEntitlement } from "@/server/billing/entitlements";
import { setAsaasFetcher } from "@/server/billing/asaas";
import { makeUser, resetDb } from "./helpers";

const TOKEN = "test-asaas-webhook-token-0123456789abcdef";

/** Simula a API do Asaas (sandbox) para os testes. */
function fakeAsaas() {
  const state = { payments: new Map<string, Record<string, unknown>>(), calls: [] as string[], subSeq: 0, lastCheckout: null as null | Record<string, unknown> };
  setAsaasFetcher(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.replace(/^.*\/v3/, "")}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    if (method === "POST" && url.endsWith("/customers")) return json({ id: "cus_TEST" });
    if (method === "GET" && url.includes("/customers?")) return json({ data: [] });
    if (method === "POST" && url.endsWith("/checkouts")) {
      state.lastCheckout = JSON.parse(String(init?.body));
      return json({ id: "chk_TEST1" });
    }
    const subGet = url.match(/\/subscriptions\/([^/]+)$/);
    if (method === "GET" && subGet) return json({ id: subGet[1], customer: "cus_TEST", status: "ACTIVE", value: 29.9, cycle: "MONTHLY", nextDueDate: "2026-11-02" });
    if (method === "POST" && url.endsWith("/subscriptions")) {
      const id = `sub_TEST${++state.subSeq}`;
      state.payments.set("pay_1", { id: "pay_1", customer: "cus_TEST", subscription: id, status: "PENDING", value: 19.9, dueDate: "2026-10-24", invoiceUrl: "https://sandbox.asaas.com/i/pay_1" });
      return json({ id, customer: "cus_TEST", status: "ACTIVE", value: 19.9, cycle: "MONTHLY", nextDueDate: "2026-10-24" });
    }
    const listMatch = url.match(/\/subscriptions\/([^/]+)\/payments$/);
    if (listMatch) return json({ data: [...state.payments.values()].filter((p) => p.subscription === listMatch[1]) });
    const payMatch = url.match(/\/payments\/([^/]+)$/);
    if (payMatch) return state.payments.has(payMatch[1]) ? json(state.payments.get(payMatch[1])) : json({ errors: [{ description: "not found" }] }, 404);
    if (method === "DELETE") return json({ deleted: true, id: url.split("/").pop() });
    return json({ errors: [{ description: "rota não simulada" }] }, 404);
  });
  return state;
}

const event = (id: string, type: string, payment: Record<string, unknown>) => JSON.stringify({ id, event: type, dateCreated: "2026-10-24 10:00:00", payment });

beforeEach(async () => {
  await resetDb();
  await db().insert(plans).values({ slug: "basico", name: "Básico", priceMonthlyCents: 1990, priceYearlyCents: 19900, active: true, limits: { monthlyMessages: 300, monthlyAiCalls: 300, maxAccounts: 3, customCategories: false, advancedReports: false } });
});
afterEach(() => setAsaasFetcher(null));
afterAll(closeDb);

describe("assinaturas com Asaas", () => {
  it("checkout cria cliente e assinatura e devolve o link da fatura; acesso só após confirmação do gateway", async () => {
    const asaas = fakeAsaas();
    const u = await makeUser();
    const r = await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    expect(r.redirectUrl).toContain("asaas.com/i/");
    expect(asaas.calls).toContain("POST /customers");
    expect((await getEntitlement(u.id)).active).toBe(false);
    expect(await getEntitlement(u.id)).toMatchObject({ reason: "pending_payment" });

    // O cliente "diz" que pagou, mas o Asaas ainda mostra PENDING: o evento não libera
    const spoof = await handleAsaasWebhook(event("evt_1", "PAYMENT_RECEIVED", { id: "pay_1", customer: "cus_TEST", subscription: "sub_TEST1", status: "RECEIVED", value: 19.9 }), TOKEN);
    expect(spoof.status).toBe(200);
    expect((await getEntitlement(u.id)).active).toBe(false);

    // Pagamento realmente confirmado no gateway
    asaas.payments.set("pay_1", { ...asaas.payments.get("pay_1")!, status: "RECEIVED", paymentDate: "2026-10-24" });
    await handleAsaasWebhook(event("evt_2", "PAYMENT_RECEIVED", { id: "pay_1", customer: "cus_TEST", subscription: "sub_TEST1", status: "RECEIVED", value: 19.9 }), TOKEN);
    const ent = await getEntitlement(u.id);
    expect(ent).toMatchObject({ active: true, planSlug: "basico" });
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.userId, u.id));
    expect(sub.currentPeriodEnd?.toISOString()).toBe("2026-11-25T03:00:00.000Z");
  });

  it("rejeita webhook sem o token configurado e ignora evento repetido", async () => {
    fakeAsaas();
    const u = await makeUser();
    await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    expect((await handleAsaasWebhook(event("evt_x", "PAYMENT_RECEIVED", { id: "pay_1", customer: "c", status: "RECEIVED", value: 1 }), "errado")).status).toBe(401);
    const body = event("evt_same", "PAYMENT_CREATED", { id: "pay_1", customer: "cus_TEST", subscription: "sub_TEST1", status: "PENDING", value: 19.9 });
    expect(await handleAsaasWebhook(body, TOKEN)).toEqual({ status: 200 });
    expect(await handleAsaasWebhook(body, TOKEN)).toEqual({ status: 200, duplicate: true });
    expect(await db().select().from(billingEvents)).toHaveLength(1);
  });

  it("inadimplência: tolerância configurável e depois bloqueio; pagamento reativa", async () => {
    const asaas = fakeAsaas();
    const u = await makeUser();
    await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    asaas.payments.set("pay_1", { ...asaas.payments.get("pay_1")!, status: "RECEIVED", paymentDate: "2026-10-24" });
    await handleAsaasWebhook(event("e1", "PAYMENT_RECEIVED", { id: "pay_1", customer: "cus_TEST", subscription: "sub_TEST1", status: "RECEIVED", value: 19.9 }), TOKEN);

    asaas.payments.set("pay_2", { id: "pay_2", customer: "cus_TEST", subscription: "sub_TEST1", status: "OVERDUE", value: 19.9, dueDate: "2026-11-24" });
    await handleAsaasWebhook(event("e2", "PAYMENT_OVERDUE", { id: "pay_2", customer: "cus_TEST", subscription: "sub_TEST1", status: "OVERDUE", value: 19.9 }), TOKEN);
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.userId, u.id));
    expect(sub.status).toBe("past_due");
    expect((await getEntitlement(u.id)).active).toBe(true); // dentro da tolerância
    const afterGrace = new Date(Date.now() + 40 * 86400_000);
    expect(await getEntitlement(u.id, afterGrace)).toMatchObject({ active: false, reason: "past_due" });

    asaas.payments.set("pay_2", { ...asaas.payments.get("pay_2")!, status: "RECEIVED", paymentDate: "2026-11-26" });
    await handleAsaasWebhook(event("e3", "PAYMENT_RECEIVED", { id: "pay_2", customer: "cus_TEST", subscription: "sub_TEST1", status: "RECEIVED", value: 19.9 }), TOKEN);
    const [reactivated] = await db().select().from(subscriptions).where(eq(subscriptions.userId, u.id));
    expect(reactivated.status).toBe("active");
  });

  it("cancelamento mantém acesso até o fim do período pago", async () => {
    const asaas = fakeAsaas();
    const u = await makeUser();
    await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    asaas.payments.set("pay_1", { ...asaas.payments.get("pay_1")!, status: "RECEIVED", paymentDate: "2026-10-24" });
    await handleAsaasWebhook(event("e1", "PAYMENT_RECEIVED", { id: "pay_1", customer: "cus_TEST", subscription: "sub_TEST1", status: "RECEIVED", value: 19.9 }), TOKEN);
    await cancelSubscription(u.id);
    expect(asaas.calls.some((c) => c.startsWith("DELETE /subscriptions/sub_TEST1"))).toBe(true);
    expect((await getEntitlement(u.id, new Date("2026-11-01T12:00:00Z"))).active).toBe(true);
    expect((await getEntitlement(u.id, new Date("2027-01-01T12:00:00Z"))).active).toBe(false);
  });

  it("estorno/chargeback suspende o acesso", async () => {
    const asaas = fakeAsaas();
    const u = await makeUser();
    await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    asaas.payments.set("pay_1", { ...asaas.payments.get("pay_1")!, status: "RECEIVED", paymentDate: "2026-10-24" });
    await handleAsaasWebhook(event("e1", "PAYMENT_RECEIVED", { id: "pay_1", customer: "cus_TEST", subscription: "sub_TEST1", status: "RECEIVED", value: 19.9 }), TOKEN);
    asaas.payments.set("pay_1", { ...asaas.payments.get("pay_1")!, status: "REFUNDED" });
    await handleAsaasWebhook(event("e2", "PAYMENT_REFUNDED", { id: "pay_1", customer: "cus_TEST", subscription: "sub_TEST1", status: "REFUNDED", value: 19.9 }), TOKEN);
    expect((await getEntitlement(u.id, new Date(Date.now() + 6 * 86400_000))).active).toBe(false);
  });

  it("cartão recorrente: abre o Asaas Checkout, vincula a assinatura criada lá e substitui o período de teste", async () => {
    const asaas = fakeAsaas();
    const u = await makeUser();
    await grantManualSubscription(u.id, "basico", 30); // período de teste
    const r = await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "credit_card", cpfCnpj: "123.456.789-09" });
    expect(r.redirectUrl).toBe("https://sandbox.asaas.com/checkoutSession/show?id=chk_TEST1");
    expect(asaas.lastCheckout).toMatchObject({ billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], customer: "cus_TEST", subscription: { cycle: "MONTHLY" } });

    // Asaas cria a assinatura depois que o cliente paga no checkout
    await handleAsaasWebhook(JSON.stringify({ id: "evt_s1", event: "SUBSCRIPTION_CREATED", subscription: { id: "sub_CARD9", customer: "cus_TEST", status: "ACTIVE" } }), TOKEN);
    const [linked] = await db().select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, "sub_CARD9"));
    expect(linked).toMatchObject({ userId: u.id, paymentMethod: "credit_card", status: "pending" });

    asaas.payments.set("pay_c1", { id: "pay_c1", customer: "cus_TEST", subscription: "sub_CARD9", status: "CONFIRMED", value: 19.9, dueDate: "2026-11-02", billingType: "CREDIT_CARD", confirmedDate: "2026-11-02" });
    await handleAsaasWebhook(event("evt_p1", "PAYMENT_CONFIRMED", { id: "pay_c1", customer: "cus_TEST", subscription: "sub_CARD9", status: "CONFIRMED", value: 19.9 }), TOKEN);
    const ent = await getEntitlement(u.id);
    expect(ent).toMatchObject({ active: true, planSlug: "basico" });
    const all = await db().select().from(subscriptions).where(eq(subscriptions.userId, u.id));
    expect(all.find((s) => s.provider === "manual")?.status).toBe("expired");
    expect(all.find((s) => s.provider === "asaas")?.status).toBe("active");
  });

  it("pagamento do cartão chegando antes do SUBSCRIPTION_CREATED também vincula", async () => {
    const asaas = fakeAsaas();
    const u = await makeUser();
    await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "credit_card", cpfCnpj: "12345678909" });
    asaas.payments.set("pay_c2", { id: "pay_c2", customer: "cus_TEST", subscription: "sub_CARD7", status: "CONFIRMED", value: 19.9, dueDate: "2026-11-02", confirmedDate: "2026-11-02" });
    await handleAsaasWebhook(event("evt_p2", "PAYMENT_CONFIRMED", { id: "pay_c2", customer: "cus_TEST", subscription: "sub_CARD7", status: "CONFIRMED", value: 19.9 }), TOKEN);
    expect((await getEntitlement(u.id)).active).toBe(true);
  });

  it("checkout expirado encerra a tentativa pendente", async () => {
    fakeAsaas();
    const u = await makeUser();
    await startCheckout(u.id, { planSlug: "basico", cycle: "monthly", method: "credit_card", cpfCnpj: "12345678909" });
    await handleAsaasWebhook(JSON.stringify({ id: "evt_x9", event: "CHECKOUT_EXPIRED", checkout: { id: "chk_TEST1", customer: "cus_TEST", status: "EXPIRED" } }), TOKEN);
    const [s] = await db().select().from(subscriptions).where(eq(subscriptions.userId, u.id));
    expect(s.status).toBe("expired");
  });
});
