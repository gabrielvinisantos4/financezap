import { and, desc, eq, inArray, isNotNull, isNull, lte, or, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { affiliateCommissions, affiliatePayouts, affiliates, subscriptions, users, type Affiliate, type Subscription } from "../db/schema";
import { env } from "../config/env";
import { FinanceError } from "../finance/errors";
import { opEvent } from "../ops/events";
import { asaas, type AsaasPayment, type AsaasSplit } from "../billing/asaas";

export const REF_COOKIE = "fz_ref";
export const REF_COOKIE_DAYS = 60;

const RESERVED = new Set(["admin", "app", "api", "financezap", "suporte", "contato", "www", "oficial", "afiliado", "afiliados"]);

export const affiliateCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "O código precisa ter pelo menos 3 letras")
  .max(24, "Use no máximo 24 caracteres")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use só letras sem acento, números e hífen")
  .refine((c) => !RESERVED.has(c), "Esse código não está disponível");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const walletIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((w) => UUID_RE.test(w), "Wallet ID inválido. Ele tem o formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.");

export function defaultCommissionBps() {
  return Math.round(env().AFFILIATE_COMMISSION_PCT * 100);
}

export async function getAffiliateByUser(userId: string): Promise<Affiliate | null> {
  const [a] = await db().select().from(affiliates).where(eq(affiliates.userId, userId));
  return a ?? null;
}

export async function getActiveAffiliateByCode(code: string): Promise<Affiliate | null> {
  const parsed = affiliateCodeSchema.safeParse(code);
  if (!parsed.success) return null;
  const [a] = await db()
    .select()
    .from(affiliates)
    .where(and(sql`lower(${affiliates.code}) = ${parsed.data}`, eq(affiliates.status, "active")));
  return a ?? null;
}

/** Sugestão de código a partir do nome (joao-silva, joao-silva2...). */
export async function suggestCode(name: string): Promise<string> {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 2)
      .join("-")
      .slice(0, 20) || "parceiro";
  for (let i = 0; i < 50; i++) {
    const c = i === 0 ? base : `${base}${i + 1}`;
    if (!RESERVED.has(c) && c.length >= 3 && !(await codeTaken(c))) return c;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

async function codeTaken(code: string) {
  const [r] = await db().select({ id: affiliates.id }).from(affiliates).where(sql`lower(${affiliates.code}) = ${code}`);
  return Boolean(r);
}

export async function createAffiliate(userId: string, rawCode: string): Promise<Affiliate> {
  const code = affiliateCodeSchema.parse(rawCode);
  if (await getAffiliateByUser(userId)) throw new FinanceError("conflict", "Você já é afiliado.");
  if (await codeTaken(code)) throw new FinanceError("conflict", "Esse código já está em uso. Escolha outro.");
  const [a] = await db().insert(affiliates).values({ userId, code, commissionBps: defaultCommissionBps() }).returning();
  await opEvent("info", "affiliate.created", "Novo afiliado", { code }, userId);
  return a;
}

/** Conta um clique no link e devolve o código normalizado (ou null se o link não vale). */
export async function registerClick(code: string): Promise<string | null> {
  const a = await getActiveAffiliateByCode(code);
  if (!a) return null;
  await db().update(affiliates).set({ clicks: sql`${affiliates.clicks} + 1` }).where(eq(affiliates.id, a.id));
  return a.code;
}

/** Vincula o cliente recém-cadastrado ao afiliado do link (nunca a ele mesmo). */
export async function attachReferral(userId: string, code: string | null | undefined) {
  if (!code) return;
  const a = await getActiveAffiliateByCode(code);
  if (!a || a.userId === userId) return;
  await db().update(users).set({ referredByAffiliateId: a.id }).where(and(eq(users.id, userId), sql`${users.referredByAffiliateId} is null`));
}

let ownWallets: { ids: string[]; at: number } | null = null;
async function isOwnWallet(walletId: string) {
  if (!env().ASAAS_API_KEY) return false;
  if (!ownWallets || Date.now() - ownWallets.at > 3600_000) {
    const r = await asaas.myWallets().catch(() => ({ data: [] as { id: string }[] }));
    ownWallets = { ids: r.data.map((w) => w.id.toLowerCase()), at: Date.now() };
  }
  return ownWallets.ids.includes(walletId.toLowerCase());
}

export async function setAffiliateWallet(userId: string, rawWallet: string) {
  const aff = await getAffiliateByUser(userId);
  if (!aff) throw new FinanceError("not_found", "Ative seu link de afiliado primeiro.");
  const walletId = walletIdSchema.parse(rawWallet);
  if (await isOwnWallet(walletId)) throw new FinanceError("invalid", "Esse Wallet ID é da conta do FinanceZap. Use o da sua conta no Asaas.");
  const [taken] = await db().select({ id: affiliates.id }).from(affiliates).where(and(eq(affiliates.walletId, walletId), sql`${affiliates.id} <> ${aff.id}`));
  if (taken) throw new FinanceError("conflict", "Esse Wallet ID já está cadastrado em outro afiliado.");
  await db().update(affiliates).set({ walletId, payoutMethod: "asaas_split" }).where(eq(affiliates.id, aff.id));
  await opEvent("info", "affiliate.wallet_set", "Afiliado cadastrou a carteira do Asaas", undefined, userId);
  if (aff.status === "active") await syncAffiliateSplits(aff.id);
}

/* ------------------------------------------------------------------ */
/* Recebimento por Pix (qualquer banco)                                 */
/* ------------------------------------------------------------------ */
export const PIX_KEY_TYPES = ["CPF", "CNPJ", "EMAIL", "PHONE", "EVP"] as const;
export type PixKeyType = (typeof PIX_KEY_TYPES)[number];

function validCpf(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}
function validCnpj(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Normaliza e valida a chave no formato que o Asaas espera. */
export function normalizePixKey(type: string, raw: string): { type: PixKeyType; key: string } {
  const t = (PIX_KEY_TYPES as readonly string[]).includes(type) ? (type as PixKeyType) : null;
  if (!t) throw new FinanceError("invalid", "Escolha o tipo da chave Pix.");
  const v = raw.trim();
  const digits = v.replace(/\D/g, "");
  if (t === "CPF") {
    if (!validCpf(digits)) throw new FinanceError("invalid", "CPF inválido.");
    return { type: t, key: digits };
  }
  if (t === "CNPJ") {
    if (!validCnpj(digits)) throw new FinanceError("invalid", "CNPJ inválido.");
    return { type: t, key: digits };
  }
  if (t === "EMAIL") {
    const e = v.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 77) throw new FinanceError("invalid", "E-mail inválido.");
    return { type: t, key: e };
  }
  if (t === "PHONE") {
    const d = digits.startsWith("55") && digits.length === 13 ? digits.slice(2) : digits;
    if (!/^\d{2}9\d{8}$/.test(d)) throw new FinanceError("invalid", "Celular inválido. Use DDD + número, ex.: 44 99999-9999.");
    return { type: t, key: d };
  }
  if (!UUID_RE.test(v)) throw new FinanceError("invalid", "Chave aleatória inválida.");
  return { type: t, key: v.toLowerCase() };
}

export async function setAffiliatePix(userId: string, type: string, rawKey: string) {
  const aff = await getAffiliateByUser(userId);
  if (!aff) throw new FinanceError("not_found", "Ative seu link de afiliado primeiro.");
  const { type: t, key } = normalizePixKey(type, rawKey);
  await db().update(affiliates).set({ pixKey: key, pixKeyType: t, payoutMethod: "pix" }).where(eq(affiliates.id, aff.id));
  await opEvent("info", "affiliate.pix_set", "Afiliado escolheu receber por Pix", { type: t }, userId);
  if (aff.status === "active") await syncAffiliateSplits(aff.id);
}

export function maskPixKey(type: string | null, key: string | null) {
  if (!key) return "";
  if (type === "EMAIL") return key.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
  if (type === "EVP") return `${key.slice(0, 8)}…${key.slice(-4)}`;
  return `${"•".repeat(Math.max(key.length - 4, 0))}${key.slice(-4)}`;
}

/** Split que vai na cobrança de um cliente indicado (ou null quando não há comissão). */
export async function splitForCustomer(customerUserId: string): Promise<{ affiliateId: string; split: AsaasSplit[] | null } | null> {
  const [u] = await db().select({ ref: users.referredByAffiliateId }).from(users).where(eq(users.id, customerUserId));
  if (!u?.ref) return null;
  const [a] = await db().select().from(affiliates).where(eq(affiliates.id, u.ref));
  if (!a || a.status !== "active" || a.userId === customerUserId || a.commissionBps <= 0) return null;
  // Pix mensal: a comissão é registrada aqui e paga depois; não vai split no Asaas
  if (a.payoutMethod === "pix") return a.pixKey ? { affiliateId: a.id, split: null } : null;
  if (!a.walletId) return null;
  return { affiliateId: a.id, split: [{ walletId: a.walletId, percentualValue: a.commissionBps / 100 }] };
}

/**
 * Garante que a assinatura no Asaas (e a cobrança pendente, se houver) tenha o split
 * do afiliado. Usado quando a assinatura nasce no Checkout ou quando o afiliado
 * cadastra a carteira depois de já ter indicados.
 */
export async function ensureRemoteSplit(sub: Subscription): Promise<void> {
  if (!sub.affiliateId || !sub.providerSubscriptionId || sub.provider !== "asaas" || !env().ASAAS_API_KEY) return;
  const [a] = await db().select().from(affiliates).where(eq(affiliates.id, sub.affiliateId));
  if (!a || a.status !== "active") return;
  if (a.payoutMethod === "pix") {
    // Trocou para Pix: tira um split antigo para não pagar em dobro
    try {
      const remote = await asaas.getSubscription(sub.providerSubscriptionId);
      if (!remote.deleted && remote.split?.length) await asaas.updateSubscriptionSplit(sub.providerSubscriptionId, []);
    } catch (err) {
      await opEvent("warn", "affiliate.split_sync_failed", "Não foi possível remover o split do afiliado", { error: String((err as Error).message).slice(0, 300) }, sub.userId);
    }
    return;
  }
  if (!a.walletId) return;
  const split: AsaasSplit[] = [{ walletId: a.walletId, percentualValue: a.commissionBps / 100 }];
  try {
    const remote = await asaas.getSubscription(sub.providerSubscriptionId);
    if (remote.deleted) return;
    if (!remote.split?.some((s) => s.walletId?.toLowerCase() === a.walletId!.toLowerCase())) {
      await asaas.updateSubscriptionSplit(sub.providerSubscriptionId, split);
    }
    const list = await asaas.listSubscriptionPayments(sub.providerSubscriptionId);
    for (const p of list.data) {
      if (p.status !== "PENDING" || !p.billingType || !p.dueDate) continue;
      if (p.split?.some((s) => s.walletId?.toLowerCase() === a.walletId!.toLowerCase())) continue;
      await asaas.updatePaymentSplit({ id: p.id, billingType: p.billingType, value: p.value, dueDate: p.dueDate }, split);
    }
  } catch (err) {
    await opEvent("warn", "affiliate.split_sync_failed", "Não foi possível aplicar o split do afiliado", { error: String((err as Error).message).slice(0, 300) }, sub.userId);
  }
}

/** Afiliado cadastrou/trocou a carteira: aplica o split nas assinaturas dos indicados que já pagam. */
export async function syncAffiliateSplits(affiliateId: string) {
  const referred = await db().select({ id: users.id }).from(users).where(eq(users.referredByAffiliateId, affiliateId));
  if (!referred.length) return;
  const subs = await db()
    .select()
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.userId, referred.map((r) => r.id)),
        eq(subscriptions.provider, "asaas"),
        isNotNull(subscriptions.providerSubscriptionId),
        inArray(subscriptions.status, ["active", "past_due", "pending"]),
      ),
    );
  for (const s of subs) {
    const [updated] = await db().update(subscriptions).set({ affiliateId }).where(eq(subscriptions.id, s.id)).returning();
    await ensureRemoteSplit(updated);
  }
}

/** Bloqueio pelo admin: tira o split das assinaturas dos indicados. */
export async function setAffiliateStatus(affiliateId: string, status: "active" | "blocked", reason?: string | null) {
  await db().update(affiliates).set({ status, blockedReason: status === "blocked" ? (reason ?? null) : null }).where(eq(affiliates.id, affiliateId));
  if (status === "active") return syncAffiliateSplits(affiliateId);
  const subs = await db().select().from(subscriptions).where(eq(subscriptions.affiliateId, affiliateId));
  for (const s of subs) {
    if (s.providerSubscriptionId && env().ASAAS_API_KEY && ["active", "past_due", "pending"].includes(s.status)) {
      await asaas.updateSubscriptionSplit(s.providerSubscriptionId, []).catch(() => undefined);
    }
    await db().update(subscriptions).set({ affiliateId: null }).where(eq(subscriptions.id, s.id));
  }
}

/** Pagamento confirmado de cliente indicado: registra a comissão (o dinheiro vai pelo split do Asaas). */
export async function recordCommission(sub: Subscription, payment: AsaasPayment) {
  if (!sub.affiliateId) return;
  const [a] = await db().select().from(affiliates).where(eq(affiliates.id, sub.affiliateId));
  if (!a) return;
  const net = Math.round((payment.netValue ?? payment.value) * 100);
  const fromSplit = a.payoutMethod === "asaas_split" ? payment.split?.find((s) => a.walletId && s.walletId?.toLowerCase() === a.walletId.toLowerCase())?.totalValue : null;
  const commission = fromSplit != null ? Math.round(fromSplit * 100) : Math.round((net * a.commissionBps) / 10000);
  await db()
    .insert(affiliateCommissions)
    .values({ affiliateId: a.id, customerUserId: sub.userId, providerPaymentId: payment.id, netCents: net, commissionCents: commission, status: "credited", paidAt: new Date() })
    .onConflictDoNothing({ target: affiliateCommissions.providerPaymentId });
}

/** Estorno/chargeback: o Asaas desfaz o split; aqui só marcamos a comissão como estornada. */
export async function reverseCommission(providerPaymentId: string) {
  const [c] = await db().select().from(affiliateCommissions).where(eq(affiliateCommissions.providerPaymentId, providerPaymentId));
  if (!c || c.status === "reversed") return;
  if (c.payoutId) {
    // Já foi incluída num Pix: desconta no próximo repasse
    const [p] = await db().select().from(affiliatePayouts).where(eq(affiliatePayouts.id, c.payoutId));
    if (p && (p.status === "paid" || p.status === "processing")) {
      await db()
        .insert(affiliateCommissions)
        .values({ affiliateId: c.affiliateId, customerUserId: c.customerUserId, providerPaymentId: `${providerPaymentId}:estorno`, netCents: -c.netCents, commissionCents: -c.commissionCents, status: "credited" })
        .onConflictDoNothing({ target: affiliateCommissions.providerPaymentId });
      await db().update(affiliateCommissions).set({ status: "reversed" }).where(eq(affiliateCommissions.id, c.id));
      return;
    }
  }
  await db().update(affiliateCommissions).set({ status: "reversed", payoutId: null }).where(eq(affiliateCommissions.id, c.id));
}

/* ------------------------------------------------------------------ */
/* Repasses mensais por Pix                                             */
/* ------------------------------------------------------------------ */
function payableFilter(affiliateId: string, now: Date) {
  const cutoff = new Date(now.getTime() - env().AFFILIATE_PIX_HOLD_DAYS * 86400_000);
  return and(
    eq(affiliateCommissions.affiliateId, affiliateId),
    eq(affiliateCommissions.status, "credited"),
    isNull(affiliateCommissions.payoutId),
    or(lte(affiliateCommissions.createdAt, cutoff), lt(affiliateCommissions.commissionCents, 0)),
  );
}

/** Saldo de Pix: o que já pode ser pago e o que ainda está na carência. */
export async function pixBalance(affiliateId: string, now = new Date()) {
  const [payable] = await db()
    .select({ c: sql<number>`coalesce(sum(${affiliateCommissions.commissionCents}), 0)::int` })
    .from(affiliateCommissions)
    .where(payableFilter(affiliateId, now));
  const [all] = await db()
    .select({ c: sql<number>`coalesce(sum(${affiliateCommissions.commissionCents}), 0)::int` })
    .from(affiliateCommissions)
    .where(and(eq(affiliateCommissions.affiliateId, affiliateId), eq(affiliateCommissions.status, "credited"), isNull(affiliateCommissions.payoutId)));
  return { payableCents: payable?.c ?? 0, pendingCents: (all?.c ?? 0) - (payable?.c ?? 0) };
}

/** Admin: gera os repasses do mês (ficam aguardando aprovação). */
export async function createPixPayouts(now = new Date()) {
  const affs = await db()
    .select()
    .from(affiliates)
    .where(and(eq(affiliates.payoutMethod, "pix"), eq(affiliates.status, "active"), isNotNull(affiliates.pixKey)));
  let created = 0;
  for (const a of affs) {
    const open = await db()
      .select({ id: affiliatePayouts.id })
      .from(affiliatePayouts)
      .where(and(eq(affiliatePayouts.affiliateId, a.id), inArray(affiliatePayouts.status, ["awaiting_approval", "processing"])));
    if (open.length) continue;
    const rows = await db().select().from(affiliateCommissions).where(payableFilter(a.id, now));
    const total = rows.reduce((s, r) => s + r.commissionCents, 0);
    if (total < Math.max(env().AFFILIATE_PIX_MIN_CENTS, 1)) continue;
    const [p] = await db()
      .insert(affiliatePayouts)
      .values({ affiliateId: a.id, amountCents: total, pixKey: a.pixKey!, pixKeyType: a.pixKeyType ?? "EVP" })
      .returning();
    await db().update(affiliateCommissions).set({ payoutId: p.id }).where(inArray(affiliateCommissions.id, rows.map((r) => r.id)));
    created++;
  }
  return created;
}

async function releasePayout(payoutId: string, status: "failed" | "canceled", failReason?: string | null) {
  await db().update(affiliatePayouts).set({ status, failReason: failReason ?? null }).where(eq(affiliatePayouts.id, payoutId));
  // Volta para o saldo e entra no próximo repasse
  await db().update(affiliateCommissions).set({ payoutId: null }).where(eq(affiliateCommissions.payoutId, payoutId));
}

/** Admin aprovou: manda o Pix pelo Asaas. */
export async function approvePixPayout(payoutId: string, adminId: string) {
  const [p] = await db().select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId));
  if (!p || p.status !== "awaiting_approval") throw new FinanceError("invalid", "Esse repasse não está aguardando aprovação.");
  // Trava contra clique duplo: só um processo consegue mudar o status
  const [locked] = await db()
    .update(affiliatePayouts)
    .set({ status: "processing", approvedBy: adminId })
    .where(and(eq(affiliatePayouts.id, p.id), eq(affiliatePayouts.status, "awaiting_approval")))
    .returning();
  if (!locked) throw new FinanceError("conflict", "Esse repasse já está sendo processado.");
  try {
    const t = await asaas.createPixTransfer({
      value: p.amountCents / 100,
      pixAddressKey: p.pixKey,
      pixAddressKeyType: p.pixKeyType,
      description: "Comissão de afiliado FinanceZap",
      externalReference: p.id,
    });
    const done = t.status === "DONE";
    await db().update(affiliatePayouts).set({ providerTransferId: t.id, status: done ? "paid" : "processing", paidAt: done ? new Date() : null }).where(eq(affiliatePayouts.id, p.id));
    await opEvent("info", "affiliate.payout_sent", "Pix de comissão enviado ao Asaas", { status: t.status });
  } catch (err) {
    const msg = String((err as Error).message).slice(0, 300);
    await releasePayout(p.id, "failed", msg);
    await opEvent("error", "affiliate.payout_failed", "Falha ao enviar Pix de comissão", { error: msg });
    throw new FinanceError("invalid", `O Asaas não aceitou o Pix: ${msg.replace(/^Asaas:\s*/, "")}`);
  }
}

/** Admin pagou por fora (ou o Asaas confirmou): marca como pago. */
export async function markPayoutPaid(payoutId: string, adminId: string) {
  await db()
    .update(affiliatePayouts)
    .set({ status: "paid", paidAt: new Date(), approvedBy: adminId })
    .where(and(eq(affiliatePayouts.id, payoutId), inArray(affiliatePayouts.status, ["awaiting_approval", "processing"])));
}

export async function cancelPayout(payoutId: string) {
  const [p] = await db().select().from(affiliatePayouts).where(eq(affiliatePayouts.id, payoutId));
  if (!p || p.status !== "awaiting_approval") throw new FinanceError("invalid", "Só dá para cancelar repasse que ainda não foi enviado.");
  await releasePayout(p.id, "canceled");
}

/** Webhook do Asaas para transferências (TRANSFER_DONE / FAILED / CANCELLED). */
export async function applyTransferEvent(event: string, transfer: { id: string; failReason?: string | null }) {
  const [p] = await db().select().from(affiliatePayouts).where(eq(affiliatePayouts.providerTransferId, transfer.id));
  if (!p) return;
  if (event === "TRANSFER_DONE" && p.status !== "paid") {
    await db().update(affiliatePayouts).set({ status: "paid", paidAt: new Date() }).where(eq(affiliatePayouts.id, p.id));
  } else if ((event === "TRANSFER_FAILED" || event === "TRANSFER_CANCELLED") && p.status !== "failed" && p.status !== "canceled") {
    await releasePayout(p.id, event === "TRANSFER_FAILED" ? "failed" : "canceled", transfer.failReason ?? null);
    await opEvent("warn", "affiliate.payout_failed", `Pix de comissão ${event === "TRANSFER_FAILED" ? "falhou" : "cancelado"} no Asaas`, { failReason: transfer.failReason ?? null });
  }
}

export async function listPayoutsForAdmin() {
  return db()
    .select({ p: affiliatePayouts, name: users.name, code: affiliates.code })
    .from(affiliatePayouts)
    .innerJoin(affiliates, eq(affiliates.id, affiliatePayouts.affiliateId))
    .innerJoin(users, eq(users.id, affiliates.userId))
    .orderBy(desc(affiliatePayouts.createdAt))
    .limit(100);
}

export async function listPayoutsForAffiliate(affiliateId: string) {
  return db().select().from(affiliatePayouts).where(eq(affiliatePayouts.affiliateId, affiliateId)).orderBy(desc(affiliatePayouts.createdAt)).limit(24);
}

/* ------------------------------------------------------------------ */
/* Painel                                                               */
/* ------------------------------------------------------------------ */
export async function affiliateDashboard(aff: Affiliate, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 3));
  const referred = await db()
    .select({ id: users.id, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.referredByAffiliateId, aff.id))
    .orderBy(desc(users.createdAt));
  const ids = referred.map((r) => r.id);
  const subs = ids.length
    ? await db()
        .select({ userId: subscriptions.userId, status: subscriptions.status, provider: subscriptions.provider, createdAt: subscriptions.createdAt })
        .from(subscriptions)
        .where(inArray(subscriptions.userId, ids))
        .orderBy(desc(subscriptions.createdAt))
    : [];
  const latest = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (s.provider === "asaas" && !latest.has(s.userId)) latest.set(s.userId, s);

  const commissions = await db()
    .select()
    .from(affiliateCommissions)
    .where(eq(affiliateCommissions.affiliateId, aff.id))
    .orderBy(desc(affiliateCommissions.createdAt))
    .limit(50);
  const credited = commissions.filter((c) => c.status === "credited");
  const [totals] = await db()
    .select({
      total: sql<number>`coalesce(sum(${affiliateCommissions.commissionCents}) filter (where ${affiliateCommissions.status} = 'credited'), 0)::int`,
      month: sql<number>`coalesce(sum(${affiliateCommissions.commissionCents}) filter (where ${affiliateCommissions.status} = 'credited' and ${affiliateCommissions.createdAt} >= ${monthStart}), 0)::int`,
    })
    .from(affiliateCommissions)
    .where(eq(affiliateCommissions.affiliateId, aff.id));

  const statusOf = (userId: string) => {
    const s = latest.get(userId);
    if (!s) return "cadastrado" as const;
    if (s.status === "active" || s.status === "past_due") return "assinante" as const;
    if (s.status === "pending") return "iniciou" as const;
    return "cancelou" as const;
  };
  return {
    clicks: aff.clicks,
    signups: referred.length,
    paying: referred.filter((r) => statusOf(r.id) === "assinante").length,
    monthCents: totals?.month ?? 0,
    totalCents: totals?.total ?? 0,
    referrals: referred.slice(0, 50).map((r) => ({ firstName: r.name.split(/\s+/)[0], createdAt: r.createdAt, status: statusOf(r.id) })),
    commissions: commissions.map((c) => ({ id: c.id, createdAt: c.createdAt, netCents: c.netCents, commissionCents: c.commissionCents, status: c.status })),
    creditedCount: credited.length,
  };
}

export async function listAffiliatesForAdmin() {
  const rows = await db()
    .select({ a: affiliates, name: users.name, email: users.email })
    .from(affiliates)
    .innerJoin(users, eq(users.id, affiliates.userId))
    .orderBy(desc(affiliates.createdAt));
  const signups = await db()
    .select({ id: users.referredByAffiliateId, n: sql<number>`count(*)::int` })
    .from(users)
    .where(isNotNull(users.referredByAffiliateId))
    .groupBy(users.referredByAffiliateId);
  const paying = await db()
    .select({ id: subscriptions.affiliateId, n: sql<number>`count(distinct ${subscriptions.userId})::int` })
    .from(subscriptions)
    .where(and(isNotNull(subscriptions.affiliateId), inArray(subscriptions.status, ["active", "past_due"])))
    .groupBy(subscriptions.affiliateId);
  const since = new Date(Date.now() - 30 * 86400_000);
  const comm = await db()
    .select({
      id: affiliateCommissions.affiliateId,
      total: sql<number>`coalesce(sum(${affiliateCommissions.commissionCents}) filter (where ${affiliateCommissions.status} = 'credited'), 0)::int`,
      last30: sql<number>`coalesce(sum(${affiliateCommissions.commissionCents}) filter (where ${affiliateCommissions.status} = 'credited' and ${affiliateCommissions.createdAt} >= ${since}), 0)::int`,
    })
    .from(affiliateCommissions)
    .groupBy(affiliateCommissions.affiliateId);
  const m = <T extends { id: string | null }>(arr: T[]) => new Map(arr.map((x) => [x.id, x]));
  const s = m(signups), p = m(paying), c = m(comm);
  return rows.map(({ a, name, email }) => ({
    ...a,
    name,
    email,
    signups: s.get(a.id)?.n ?? 0,
    paying: p.get(a.id)?.n ?? 0,
    totalCents: c.get(a.id)?.total ?? 0,
    last30Cents: c.get(a.id)?.last30 ?? 0,
  }));
}

