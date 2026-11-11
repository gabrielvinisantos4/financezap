import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/server/db/client";
import { affiliateCommissions, affiliatePayouts, affiliates, plans, subscriptions, users } from "@/server/db/schema";
import { handleAsaasWebhook, startCheckout } from "@/server/billing/subscriptions";
import { setAsaasFetcher } from "@/server/billing/asaas";
import { affiliateDashboard, approvePixPayout, attachReferral, createAffiliate, createPixPayouts, normalizePixKey, pixBalance, registerClick, setAffiliatePix, setAffiliateStatus, setAffiliateWallet, splitForCustomer } from "@/server/affiliates/affiliates";
import { makeUser, resetDb } from "./helpers";

const TOKEN = "test-asaas-webhook-token-0123456789abcdef";
const WALLET = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const OWN_WALLET = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function fakeAsaas(opts: { rejectSplit?: boolean; failTransfer?: boolean } = {}) {
  const st = {
    calls: [] as string[],
    bodies: new Map<string, unknown>(),
    subs: new Map<string, Record<string, unknown>>(),
    payments: new Map<string, Record<string, unknown>>(),
    seq: 0,
  };
  setAsaasFetcher(async (input, init) => {
    const url = String(input).replace(/^.*\/v3/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    st.calls.push(`${method} ${url}`);
    if (body) st.bodies.set(`${method} ${url}`, body);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
    const splitErr = () => json({ errors: [{ description: "Wallet [x] inexistente para split." }] }, 400);
    if (method === "GET" && url === "/wallets") return json({ data: [{ id: OWN_WALLET }] });
    if (method === "POST" && url === "/customers") return json({ id: "cus_T" });
    if (method === "GET" && url.startsWith("/customers?")) return json({ data: [] });
    if (method === "POST" && url === "/checkouts") return opts.rejectSplit && body.splits ? splitErr() : json({ id: `chk_${++st.seq}` });
    if (method === "POST" && url === "/subscriptions") {
      if (opts.rejectSplit && body.split) return splitErr();
      const id = `sub_${++st.seq}`;
      st.subs.set(id, { id, customer: "cus_T", status: "ACTIVE", value: body.value, cycle: body.cycle, nextDueDate: body.nextDueDate, split: body.split ?? null });
      st.payments.set(`pay_${id}`, { id: `pay_${id}`, customer: "cus_T", subscription: id, status: "PENDING", value: body.value, billingType: "PIX", dueDate: body.nextDueDate, invoiceUrl: "https://x/i/1" });
      return json(st.subs.get(id));
    }
    const sub = url.match(/^\/subscriptions\/([^/]+)$/);
    if (sub && method === "GET") return json(st.subs.get(sub[1]) ?? { id: sub[1], customer: "cus_T", status: "ACTIVE", value: 16.9, cycle: "MONTHLY", nextDueDate: "2030-01-01", split: null });
    if (sub && method === "PUT") {
      const cur = st.subs.get(sub[1]) ?? { id: sub[1], customer: "cus_T", status: "ACTIVE", value: 16.9, cycle: "MONTHLY", nextDueDate: "2030-01-01" };
      st.subs.set(sub[1], { ...cur, split: body.split });
      return json(st.subs.get(sub[1]));
    }
    const list = url.match(/^\/subscriptions\/([^/]+)\/payments$/);
    if (list) return json({ data: [...st.payments.values()].filter((p) => p.subscription === list[1]) });
    const pay = url.match(/^\/payments\/([^/]+)$/);
    if (pay && method === "GET") return st.payments.has(pay[1]) ? json(st.payments.get(pay[1])) : json({ errors: [{ description: "not found" }] }, 404);
    if (pay && method === "POST") {
      st.payments.set(pay[1], { ...st.payments.get(pay[1]), split: body.split });
      return json(st.payments.get(pay[1]));
    }
    if (method === "POST" && url === "/transfers") return opts.failTransfer ? json({ errors: [{ description: "Saldo insuficiente." }] }, 400) : json({ id: `tra_${++st.seq}`, status: "PENDING" });
    if (method === "DELETE") return json({ deleted: true });
    return json({ errors: [{ description: `rota não simulada ${method} ${url}` }] }, 404);
  });
  return st;
}

async function makeAffiliate(code = "maria") {
  const owner = await makeUser({ name: "Maria Afiliada", email: `${code}@exemplo.test` });
  const aff = await createAffiliate(owner.id, code);
  return { owner, aff };
}

beforeEach(async () => {
  await resetDb();
  await db().insert(plans).values({ slug: "basico", name: "Básico", priceMonthlyCents: 1690, priceYearlyCents: 16900, active: true, limits: { monthlyMessages: 300, monthlyAiCalls: 300, maxAccounts: 3, customCategories: false, advancedReports: false } });
});
afterEach(() => setAsaasFetcher(null));
afterAll(closeDb);

describe("programa de afiliados", () => {
  it("link registra clique, cliente indicado assina por Pix com split de 30% e a comissão é registrada no pagamento", async () => {
    const st = fakeAsaas();
    const { aff } = await makeAffiliate();
    await setAffiliateWallet(aff.userId, WALLET);
    expect(await registerClick("MARIA")).toBe("maria");
    expect(await registerClick("nao-existe")).toBeNull();

    const client = await makeUser({ name: "João Cliente", email: "joao@exemplo.test" });
    await attachReferral(client.id, "maria");
    expect(await splitForCustomer(client.id)).toEqual({ affiliateId: aff.id, split: [{ walletId: WALLET, percentualValue: 30 }] });

    await startCheckout(client.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    expect(st.bodies.get("POST /subscriptions")).toMatchObject({ split: [{ walletId: WALLET, percentualValue: 30 }] });
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.userId, client.id));
    expect(sub.affiliateId).toBe(aff.id);

    // Pagamento confirmado: valor líquido 16,05 → 30% = 4,82 (vem do split informado pelo Asaas)
    const payId = `pay_${sub.providerSubscriptionId}`;
    st.payments.set(payId, { ...st.payments.get(payId)!, status: "RECEIVED", paymentDate: "2026-11-11", netValue: 16.05, split: [{ walletId: WALLET, totalValue: 4.82 }] });
    await handleAsaasWebhook(JSON.stringify({ id: "evt_a1", event: "PAYMENT_RECEIVED", payment: { id: payId, customer: "cus_T", subscription: sub.providerSubscriptionId, status: "RECEIVED", value: 16.9 } }), TOKEN);
    const [c] = await db().select().from(affiliateCommissions);
    expect(c).toMatchObject({ affiliateId: aff.id, customerUserId: client.id, netCents: 1605, commissionCents: 482, status: "credited" });

    const d = await affiliateDashboard((await db().select().from(affiliates))[0]);
    expect(d).toMatchObject({ clicks: 1, signups: 1, paying: 1, totalCents: 482 });
    expect(d.referrals[0]).toMatchObject({ firstName: "João", status: "assinante" });

    // Estorno desfaz a comissão
    st.payments.set(payId, { ...st.payments.get(payId)!, status: "REFUNDED" });
    await handleAsaasWebhook(JSON.stringify({ id: "evt_a2", event: "PAYMENT_REFUNDED", payment: { id: payId, customer: "cus_T", subscription: sub.providerSubscriptionId, status: "REFUNDED", value: 16.9 } }), TOKEN);
    expect((await db().select().from(affiliateCommissions))[0].status).toBe("reversed");
  });

  it("cartão: o split vai no Checkout e é conferido quando a assinatura é vinculada", async () => {
    const st = fakeAsaas();
    const { aff } = await makeAffiliate();
    await setAffiliateWallet(aff.userId, WALLET);
    const client = await makeUser();
    await attachReferral(client.id, "maria");
    await startCheckout(client.id, { planSlug: "basico", cycle: "monthly", method: "credit_card", cpfCnpj: "12345678909" });
    expect(st.bodies.get("POST /checkouts")).toMatchObject({ splits: [{ walletId: WALLET, percentualValue: 30 }] });

    // O Asaas criou a assinatura sem o split: o sistema aplica na assinatura e na 1ª cobrança
    const [local] = await db().select().from(subscriptions).where(eq(subscriptions.userId, client.id));
    st.subs.set("sub_card", { id: "sub_card", customer: "cus_T", status: "ACTIVE", value: 16.9, cycle: "MONTHLY", nextDueDate: "2030-01-01", externalReference: local.id, split: null });
    st.payments.set("pay_card", { id: "pay_card", customer: "cus_T", subscription: "sub_card", status: "PENDING", value: 16.9, billingType: "CREDIT_CARD", dueDate: "2030-01-01" });
    await handleAsaasWebhook(JSON.stringify({ id: "evt_c1", event: "SUBSCRIPTION_CREATED", subscription: { id: "sub_card", customer: "cus_T", externalReference: local.id, status: "ACTIVE" } }), TOKEN);
    expect(st.bodies.get("PUT /subscriptions/sub_card")).toMatchObject({ split: [{ walletId: WALLET, percentualValue: 30 }] });
    expect(st.bodies.get("POST /payments/pay_card")).toMatchObject({ split: [{ walletId: WALLET, percentualValue: 30 }] });
  });

  it("sem carteira não há split; ao cadastrar a carteira, as assinaturas dos indicados passam a ter split", async () => {
    const st = fakeAsaas();
    const { aff } = await makeAffiliate();
    const client = await makeUser();
    await attachReferral(client.id, "maria");
    await startCheckout(client.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    expect((st.bodies.get("POST /subscriptions") as { split?: unknown }).split).toBeUndefined();
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.userId, client.id));
    expect(sub.affiliateId).toBeNull();

    await setAffiliateWallet(aff.userId, WALLET);
    expect(st.bodies.get(`PUT /subscriptions/${sub.providerSubscriptionId}`)).toMatchObject({ split: [{ walletId: WALLET, percentualValue: 30 }] });
    const [after] = await db().select().from(subscriptions).where(eq(subscriptions.userId, client.id));
    expect(after.affiliateId).toBe(aff.id);

    // Bloqueio tira o split
    await setAffiliateStatus(aff.id, "blocked", "spam");
    expect(st.bodies.get(`PUT /subscriptions/${sub.providerSubscriptionId}`)).toMatchObject({ split: [] });
    expect(await splitForCustomer(client.id)).toBeNull();
  });

  it("se o Asaas recusar o split, o cliente assina normalmente sem comissão", async () => {
    const st = fakeAsaas({ rejectSplit: true });
    const { aff } = await makeAffiliate();
    await setAffiliateWallet(aff.userId, WALLET);
    const client = await makeUser();
    await attachReferral(client.id, "maria");
    const r = await startCheckout(client.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    expect(r.redirectUrl).toBeTruthy();
    expect(st.calls.filter((c) => c === "POST /subscriptions")).toHaveLength(2);
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.userId, client.id));
    expect(sub.affiliateId).toBeNull();
  });

  it("valida código, carteira e não deixa indicar a si mesmo", async () => {
    fakeAsaas();
    const { owner, aff } = await makeAffiliate("ana");
    await expect(createAffiliate((await makeUser()).id, "ANA")).rejects.toThrow(/em uso/);
    await expect(createAffiliate((await makeUser()).id, "admin")).rejects.toThrow();
    await expect(setAffiliateWallet(owner.id, "123")).rejects.toThrow(/Wallet ID inválido/);
    await expect(setAffiliateWallet(owner.id, OWN_WALLET)).rejects.toThrow(/conta do FinanceZap/);
    await attachReferral(owner.id, "ana");
    const [u] = await db().select().from(users).where(eq(users.id, owner.id));
    expect(u.referredByAffiliateId).toBeNull();
    expect(aff.commissionBps).toBe(3000);
  });

  it("Pix mensal: sem split no Asaas, comissão acumula, carência de 7 dias, repasse aprovado vira Pix e o webhook confirma", async () => {
    const st = fakeAsaas();
    const { aff } = await makeAffiliate();
    await setAffiliatePix(aff.userId, "CPF", "529.982.247-25");
    const client = await makeUser();
    await attachReferral(client.id, "maria");
    expect(await splitForCustomer(client.id)).toEqual({ affiliateId: aff.id, split: null });

    await startCheckout(client.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    expect((st.bodies.get("POST /subscriptions") as { split?: unknown }).split).toBeUndefined();
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.userId, client.id));
    expect(sub.affiliateId).toBe(aff.id);

    const payId = `pay_${sub.providerSubscriptionId}`;
    st.payments.set(payId, { ...st.payments.get(payId)!, status: "RECEIVED", paymentDate: "2026-11-11", netValue: 16.0 });
    await handleAsaasWebhook(JSON.stringify({ id: "evt_p1", event: "PAYMENT_RECEIVED", payment: { id: payId, customer: "cus_T", subscription: sub.providerSubscriptionId, status: "RECEIVED", value: 16.9 } }), TOKEN);
    const [c] = await db().select().from(affiliateCommissions);
    expect(c.commissionCents).toBe(480);

    // Ainda na carência: nada a pagar
    expect(await pixBalance(aff.id)).toEqual({ payableCents: 0, pendingCents: 480 });
    expect(await createPixPayouts()).toBe(0);

    // 8 dias depois, mas abaixo do mínimo de R$ 20: não gera
    const later = new Date(Date.now() + 8 * 86400_000);
    expect(await pixBalance(aff.id, later)).toEqual({ payableCents: 480, pendingCents: 0 });
    expect(await createPixPayouts(later)).toBe(0);

    // Com mais comissões, passa do mínimo
    for (let i = 0; i < 4; i++) {
      await db().insert(affiliateCommissions).values({ affiliateId: aff.id, customerUserId: client.id, providerPaymentId: `pay_x${i}`, netCents: 1600, commissionCents: 480, createdAt: new Date(Date.now() - 10 * 86400_000) });
    }
    expect(await createPixPayouts(later)).toBe(1);
    const [p] = await db().select().from(affiliatePayouts);
    expect(p).toMatchObject({ amountCents: 2400, status: "awaiting_approval", pixKey: "52998224725", pixKeyType: "CPF" });

    const admin = await makeUser({ email: "admin@exemplo.test" });
    await approvePixPayout(p.id, admin.id);
    expect(st.bodies.get("POST /transfers")).toMatchObject({ value: 24, pixAddressKey: "52998224725", pixAddressKeyType: "CPF", operationType: "PIX", externalReference: p.id });
    await expect(approvePixPayout(p.id, admin.id)).rejects.toThrow(); // clique duplo não manda dois Pix

    const [sent] = await db().select().from(affiliatePayouts);
    await handleAsaasWebhook(JSON.stringify({ id: "evt_t1", event: "TRANSFER_DONE", transfer: { id: sent.providerTransferId, status: "DONE" } }), TOKEN);
    expect((await db().select().from(affiliatePayouts))[0].status).toBe("paid");

    // Estorno de comissão já paga: vira desconto no próximo repasse
    st.payments.set(payId, { ...st.payments.get(payId)!, status: "REFUNDED" });
    await handleAsaasWebhook(JSON.stringify({ id: "evt_p2", event: "PAYMENT_REFUNDED", payment: { id: payId, customer: "cus_T", subscription: sub.providerSubscriptionId, status: "REFUNDED", value: 16.9 } }), TOKEN);
    expect(await pixBalance(aff.id, later)).toEqual({ payableCents: -480, pendingCents: 0 });
  });

  it("Pix que falha no Asaas devolve o valor para o saldo", async () => {
    fakeAsaas({ failTransfer: true });
    const { aff } = await makeAffiliate();
    await setAffiliatePix(aff.userId, "EMAIL", "Maria@Exemplo.test");
    await db().insert(affiliateCommissions).values({ affiliateId: aff.id, providerPaymentId: "pay_old", netCents: 10000, commissionCents: 3000, createdAt: new Date(Date.now() - 20 * 86400_000) });
    expect(await createPixPayouts()).toBe(1);
    const [p] = await db().select().from(affiliatePayouts);
    await expect(approvePixPayout(p.id, aff.userId)).rejects.toThrow(/Saldo insuficiente/);
    expect((await db().select().from(affiliatePayouts))[0]).toMatchObject({ status: "failed" });
    expect(await pixBalance(aff.id)).toEqual({ payableCents: 3000, pendingCents: 0 });
  });

  it("trocar de Asaas para Pix tira o split das assinaturas dos indicados", async () => {
    const st = fakeAsaas();
    const { aff } = await makeAffiliate();
    await setAffiliateWallet(aff.userId, WALLET);
    const client = await makeUser();
    await attachReferral(client.id, "maria");
    await startCheckout(client.id, { planSlug: "basico", cycle: "monthly", method: "pix", cpfCnpj: "12345678909" });
    const [sub] = await db().select().from(subscriptions).where(eq(subscriptions.userId, client.id));
    await setAffiliatePix(aff.userId, "PHONE", "(44) 99188-7438");
    expect(st.bodies.get(`PUT /subscriptions/${sub.providerSubscriptionId}`)).toMatchObject({ split: [] });
    expect(normalizePixKey("PHONE", "+55 44 99188-7438")).toEqual({ type: "PHONE", key: "44991887438" });
    expect(() => normalizePixKey("CPF", "111.111.111-11")).toThrow(/CPF inválido/);
  });
});
