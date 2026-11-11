import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { affiliateCommissions, affiliates, subscriptions, users, type Affiliate, type Subscription } from "../db/schema";
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
  await db().update(affiliates).set({ walletId }).where(eq(affiliates.id, aff.id));
  await opEvent("info", "affiliate.wallet_set", "Afiliado cadastrou a carteira do Asaas", undefined, userId);
  if (aff.status === "active") await syncAffiliateSplits(aff.id);
}

/** Split que vai na cobrança de um cliente indicado (ou null quando não há comissão). */
export async function splitForCustomer(customerUserId: string): Promise<{ affiliateId: string; split: AsaasSplit[] } | null> {
  const [u] = await db().select({ ref: users.referredByAffiliateId }).from(users).where(eq(users.id, customerUserId));
  if (!u?.ref) return null;
  const [a] = await db().select().from(affiliates).where(eq(affiliates.id, u.ref));
  if (!a || a.status !== "active" || !a.walletId || a.userId === customerUserId || a.commissionBps <= 0) return null;
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
  if (!a || a.status !== "active" || !a.walletId) return;
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
  const fromSplit = payment.split?.find((s) => a.walletId && s.walletId?.toLowerCase() === a.walletId.toLowerCase())?.totalValue;
  const commission = fromSplit != null ? Math.round(fromSplit * 100) : Math.round((net * a.commissionBps) / 10000);
  await db()
    .insert(affiliateCommissions)
    .values({ affiliateId: a.id, customerUserId: sub.userId, providerPaymentId: payment.id, netCents: net, commissionCents: commission, status: "credited", paidAt: new Date() })
    .onConflictDoUpdate({ target: affiliateCommissions.providerPaymentId, set: { netCents: net, commissionCents: commission, status: "credited" } });
}

/** Estorno/chargeback: o Asaas desfaz o split; aqui só marcamos a comissão como estornada. */
export async function reverseCommission(providerPaymentId: string) {
  await db().update(affiliateCommissions).set({ status: "reversed" }).where(eq(affiliateCommissions.providerPaymentId, providerPaymentId));
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

