import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { adminAuditLogs, inboundMessages, operationalEvents, plans, subscriptions, usageEvents, users, whatsappIdentities, type User } from "../db/schema";
import { maskEmail, maskPhone } from "../security/crypto";
import { env } from "../config/env";
import { startOfMonthUtc } from "../billing/entitlements";
import { FinanceError } from "../finance/errors";

/**
 * Métricas do negócio. Por desenho, NENHUMA consulta aqui lê tabelas financeiras
 * dos clientes (transações, contas, categorias): o admin vê o negócio, não o
 * dinheiro das pessoas.
 */
export async function businessMetrics(now = new Date()) {
  const monthStart = startOfMonthUtc(now);
  const last30 = new Date(now.getTime() - 30 * 86400_000);

  const [u] = await db()
    .select({
      total: sql<number>`count(*) filter (where ${users.status} <> 'deleted' and ${users.role} = 'user')::int`,
      new30: sql<number>`count(*) filter (where ${users.createdAt} >= ${last30} and ${users.role} = 'user')::int`,
      blocked: sql<number>`count(*) filter (where ${users.status} = 'blocked')::int`,
    })
    .from(users);

  const latestSubs = await db().execute<{ status: string; cycle: string; price_cents: number; plan_name: string; provider: string; canceled_at: Date | null }>(sql`
    select distinct on (s.user_id) s.status::text, s.cycle::text, s.price_cents, p.name as plan_name, s.provider, s.canceled_at
      from subscriptions s join plans p on p.id = s.plan_id
     order by s.user_id, s.created_at desc`);
  const subs = latestSubs.rows;
  const active = subs.filter((s) => s.status === "active");
  const mrrCents = active.filter((s) => s.provider !== "manual").reduce((sum, s) => sum + (s.cycle === "yearly" ? Math.round(s.price_cents / 12) : s.price_cents), 0);
  const byPlan = new Map<string, number>();
  for (const s of active) byPlan.set(s.plan_name, (byPlan.get(s.plan_name) ?? 0) + 1);

  const [cancel] = await db()
    .select({ c: sql<number>`count(*)::int` })
    .from(subscriptions)
    .where(and(gte(subscriptions.canceledAt, last30)));

  const [ai] = await db()
    .select({
      calls: sql<number>`count(*) filter (where ${usageEvents.type} = 'ai_call')::int`,
      tokensIn: sql<number>`coalesce(sum(${usageEvents.tokensIn}), 0)::bigint`,
      tokensOut: sql<number>`coalesce(sum(${usageEvents.tokensOut}), 0)::bigint`,
      aiCost: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}) filter (where ${usageEvents.type} = 'ai_call'), 0)::bigint`,
      waCost: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}) filter (where ${usageEvents.type} = 'wa_outbound'), 0)::bigint`,
      inbound: sql<number>`count(*) filter (where ${usageEvents.type} = 'wa_inbound')::int`,
      outbound: sql<number>`count(*) filter (where ${usageEvents.type} = 'wa_outbound')::int`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, monthStart));

  const [fail] = await db()
    .select({ failed: sql<number>`count(*) filter (where ${inboundMessages.status} = 'failed')::int`, queued: sql<number>`count(*) filter (where ${inboundMessages.status} in ('queued','processing'))::int` })
    .from(inboundMessages)
    .where(gte(inboundMessages.receivedAt, last30));

  const rate = env().USD_BRL_RATE;
  const aiCostBrlCents = Math.round((Number(ai.aiCost) / 1_000_000) * rate * 100);
  const waCostBrlCents = Math.round((Number(ai.waCost) / 1_000_000) * rate * 100);

  return {
    users: { total: u.total, new30: u.new30, blocked: u.blocked },
    subscriptions: {
      active: active.length,
      pastDue: subs.filter((s) => s.status === "past_due").length,
      pending: subs.filter((s) => s.status === "pending").length,
      canceled30: cancel.c,
      courtesy: active.filter((s) => s.provider === "manual").length,
      byPlan: [...byPlan.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
    mrrCents,
    usageMonth: { aiCalls: ai.calls, tokensIn: Number(ai.tokensIn), tokensOut: Number(ai.tokensOut), inbound: ai.inbound, outbound: ai.outbound },
    costsMonth: { aiBrlCents: aiCostBrlCents, whatsappBrlCents: waCostBrlCents, totalBrlCents: aiCostBrlCents + waCostBrlCents },
    processing: { failed30: fail.failed, inQueue: fail.queued },
  };
}

export async function recentOperationalEvents(limit = 50, level?: string) {
  const conds = level ? [eq(operationalEvents.level, level)] : [];
  return db().select().from(operationalEvents).where(conds.length ? and(...conds) : undefined).orderBy(desc(operationalEvents.createdAt)).limit(limit);
}

/* ------------------------------------------------------------------ */
/* Clientes                                                             */
/* ------------------------------------------------------------------ */
export type CustomerRow = { id: string; name: string; email: string; phone: string; status: string; role: string; createdAt: Date; plan: string | null; subStatus: string | null; whatsappLinked: boolean };

export async function searchCustomers(admin: User, query: string, canSeePii: boolean): Promise<CustomerRow[]> {
  const q = query.trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  // Busca por identificador sempre; por e-mail apenas para quem tem permissão de PII
  const where = !q ? undefined : uuid ? eq(users.id, q) : canSeePii ? sql`lower(${users.email}) like ${`%${q.toLowerCase().replace(/[%_\\]/g, "")}%`}` : sql`false`;
  const rows = await db()
    .select({ u: users, waId: whatsappIdentities.waId })
    .from(users)
    .leftJoin(whatsappIdentities, eq(whatsappIdentities.userId, users.id))
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(50);
  const ids = rows.map((r) => r.u.id);
  const subs = ids.length
    ? await db().execute<{ user_id: string; status: string; plan: string }>(sql`
        select distinct on (s.user_id) s.user_id, s.status::text, p.name as plan
          from subscriptions s join plans p on p.id = s.plan_id
         where s.user_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
         order by s.user_id, s.created_at desc`)
    : { rows: [] };
  if (canSeePii && q) await audit(admin.id, "customers.search_pii", null, null, { query: uuid ? "id" : "email" });
  return rows.map((r) => {
    const s = subs.rows.find((x) => x.user_id === r.u.id);
    return {
      id: r.u.id,
      name: canSeePii ? r.u.name : `${r.u.name.split(" ")[0].slice(0, 1)}***`,
      email: canSeePii ? r.u.email : maskEmail(r.u.email),
      phone: canSeePii ? (r.u.phoneE164 ?? "—") : maskPhone(r.u.phoneE164),
      status: r.u.status,
      role: r.u.role,
      createdAt: r.u.createdAt,
      plan: s?.plan ?? null,
      subStatus: s?.status ?? null,
      whatsappLinked: Boolean(r.waId),
    };
  });
}

export async function audit(adminId: string, action: string, targetUserId: string | null, reason: string | null, meta?: Record<string, unknown>) {
  await db().insert(adminAuditLogs).values({ adminId, action, targetUserId, reason, meta: meta ?? null });
}

export async function setUserBlocked(admin: User, targetId: string, blocked: boolean, reason: string) {
  if (admin.id === targetId) throw new FinanceError("invalid", "Você não pode bloquear a própria conta.");
  const [target] = await db().select().from(users).where(eq(users.id, targetId));
  if (!target || target.status === "deleted") throw new FinanceError("not_found", "Cliente não encontrado.");
  if (target.role === "owner") throw new FinanceError("forbidden", "O proprietário não pode ser bloqueado.");
  if (!reason.trim()) throw new FinanceError("invalid", "Informe o motivo.");
  await db().update(users).set({ status: blocked ? "blocked" : "active", blockedReason: blocked ? reason.slice(0, 300) : null }).where(eq(users.id, targetId));
  await audit(admin.id, blocked ? "user.block" : "user.unblock", targetId, reason.slice(0, 300));
}

export async function auditLog(limit = 50) {
  return db()
    .select({ log: adminAuditLogs, adminName: users.name })
    .from(adminAuditLogs)
    .innerJoin(users, eq(users.id, adminAuditLogs.adminId))
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit);
}

/* ------------------------------------------------------------------ */
/* Planos (preços e limites configuráveis, nunca fixos no código)       */
/* ------------------------------------------------------------------ */
export const planSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, "Use letras minúsculas, números e hífen"),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).default(""),
  priceMonthlyCents: z.coerce.number().int().min(0).max(10_000_00),
  priceYearlyCents: z.coerce.number().int().min(0).max(100_000_00),
  features: z.array(z.string().trim().min(1).max(80)).max(12),
  monthlyMessages: z.coerce.number().int().min(1).max(100_000),
  monthlyAiCalls: z.coerce.number().int().min(0).max(100_000),
  maxAccounts: z.coerce.number().int().min(1).max(200),
  customCategories: z.boolean(),
  advancedReports: z.boolean(),
  active: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(100),
});

export async function listAllPlans() {
  return db().select().from(plans).orderBy(plans.sortOrder);
}

export async function savePlan(admin: User, input: z.infer<typeof planSchema>) {
  const values = {
    slug: input.slug,
    name: input.name,
    description: input.description,
    priceMonthlyCents: input.priceMonthlyCents,
    priceYearlyCents: input.priceYearlyCents,
    features: input.features,
    limits: { monthlyMessages: input.monthlyMessages, monthlyAiCalls: input.monthlyAiCalls, maxAccounts: input.maxAccounts, customCategories: input.customCategories, advancedReports: input.advancedReports },
    active: input.active,
    sortOrder: input.sortOrder,
  };
  if (input.active && (input.priceMonthlyCents <= 0 || input.priceYearlyCents <= 0)) throw new FinanceError("invalid", "Defina os preços antes de ativar o plano.");
  if (input.id) {
    await db().update(plans).set(values).where(eq(plans.id, input.id));
  } else {
    await db().insert(plans).values(values);
  }
  // Assinaturas existentes mantêm o preço contratado (subscriptions.price_cents)
  await audit(admin.id, input.id ? "plan.update" : "plan.create", null, null, { slug: input.slug, active: input.active });
}

export async function failedMessages(limit = 30) {
  return db()
    .select({ id: inboundMessages.id, status: inboundMessages.status, attempts: inboundMessages.attempts, error: inboundMessages.error, receivedAt: inboundMessages.receivedAt, userId: inboundMessages.userId })
    .from(inboundMessages)
    .where(inArray(inboundMessages.status, ["failed"]))
    .orderBy(desc(inboundMessages.receivedAt))
    .limit(limit);
}
