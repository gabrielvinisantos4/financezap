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

  const subs = (await currentAccess()).filter((s) => s.role === "user");
  const active = subs.filter((s) => s.status === "active");
  // Receita só de quem já pagou de verdade (teste com cartão ainda não conta)
  const mrrCents = active.filter((s) => s.kind === "paid").reduce((sum, s) => sum + (s.cycle === "yearly" ? Math.round(s.priceCents / 12) : s.priceCents), 0);
  const byPlan = new Map<string, number>();
  for (const s of active) byPlan.set(s.plan, (byPlan.get(s.plan) ?? 0) + 1);

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
      paid: active.filter((s) => s.kind === "paid").length,
      trial: active.filter((s) => s.kind === "trial" || s.kind === "card_trial").length,
      courtesy: active.filter((s) => s.kind === "courtesy").length,
      byPlan: [...byPlan.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    },
    mrrCents,
    usageMonth: { aiCalls: ai.calls, tokensIn: Number(ai.tokensIn), tokensOut: Number(ai.tokensOut), inbound: ai.inbound, outbound: ai.outbound },
    costsMonth: { aiBrlCents: aiCostBrlCents, whatsappBrlCents: waCostBrlCents, totalBrlCents: aiCostBrlCents + waCostBrlCents },
    processing: { failed30: fail.failed, inQueue: fail.queued },
  };
}

/* ------------------------------------------------------------------ */
/* Situação de acesso de cada cliente (teste, cortesia, pago) e vencimento */
/* ------------------------------------------------------------------ */
export type AccessKind = "paid" | "card_trial" | "trial" | "courtesy" | "past_due" | "pending" | "ended";
export type AccessRow = { userId: string; name: string; email: string; role: string; plan: string; cycle: string; priceCents: number; status: string; kind: AccessKind; endsAt: Date | null };

export const ACCESS_LABELS: Record<AccessKind, string> = {
  paid: "Pagante",
  card_trial: "Teste grátis (cartão)",
  trial: "Teste grátis",
  courtesy: "Cortesia",
  past_due: "Pagamento atrasado",
  pending: "Aguardando pagamento",
  ended: "Encerrado",
};

/**
 * Assinatura que vale hoje para cada cliente: prefere a ativa (ou em atraso) com o
 * vencimento mais distante; sem nenhuma, a mais recente. Uma tentativa de pagamento
 * abandonada não esconde um teste que ainda está valendo.
 * Cortesia = liberada pelo admin (fica na auditoria); os demais acessos sem pagamento são teste grátis.
 */
export async function currentAccess(): Promise<AccessRow[]> {
  const r = await db().execute<{
    user_id: string; name: string; email: string; role: string; plan: string; cycle: string; price_cents: number; status: string; provider: string;
    current_period_end: Date | null; courtesy: boolean; has_paid: boolean;
  }>(sql`
    with cur as (
      select distinct on (s.user_id) s.id, s.user_id, s.status::text as status, s.provider, s.cycle::text as cycle, s.price_cents, s.current_period_end, s.created_at, p.name as plan
        from subscriptions s join plans p on p.id = s.plan_id
       order by s.user_id, (s.status::text in ('active', 'past_due')) desc, s.current_period_end desc nulls last, s.created_at desc
    )
    select cur.user_id, u.name, u.email, u.role::text as role, cur.plan, cur.cycle, cur.price_cents, cur.status, cur.provider, cur.current_period_end,
           exists (select 1 from admin_audit_logs a where a.target_user_id = cur.user_id and a.action = 'subscription.courtesy'
                    and a.created_at between cur.created_at - interval '5 minutes' and cur.created_at + interval '5 minutes') as courtesy,
           exists (select 1 from payments pm where pm.subscription_id = cur.id and pm.paid_at is not null) as has_paid
      from cur join users u on u.id = cur.user_id
     where u.status <> 'deleted'`);
  return r.rows.map((x) => {
    const kind: AccessKind =
      x.status === "active"
        ? x.provider === "manual"
          ? x.courtesy
            ? "courtesy"
            : "trial"
          : x.has_paid
          ? "paid"
          : "card_trial"
        : x.status === "past_due"
        ? "past_due"
        : x.status === "pending"
        ? "pending"
        : "ended";
    return { userId: x.user_id, name: x.name, email: x.email, role: x.role, plan: x.plan, cycle: x.cycle, priceCents: x.price_cents, status: x.status, kind, endsAt: x.current_period_end ? new Date(x.current_period_end) : null };
  });
}

/** Lista para o painel do dono: quem está em teste/cortesia/pagando e quando vence. */
export async function accessOverview(canSeePii: boolean) {
  const rows = (await currentAccess()).filter((r) => r.role === "user");
  const order: AccessKind[] = ["past_due", "trial", "card_trial", "courtesy", "pending", "paid", "ended"];
  return rows
    .map((r) => ({ ...r, name: canSeePii ? r.name : `${r.name.split(" ")[0].slice(0, 1)}***`, email: canSeePii ? r.email : maskEmail(r.email) }))
    .sort((a, b) => {
      const live = (k: AccessKind) => (k === "ended" || k === "pending" ? 1 : 0);
      if (live(a.kind) !== live(b.kind)) return live(a.kind) - live(b.kind);
      if (live(a.kind) === 0) return (a.endsAt?.getTime() ?? Infinity) - (b.endsAt?.getTime() ?? Infinity);
      return order.indexOf(a.kind) - order.indexOf(b.kind);
    });
}

export async function recentOperationalEvents(limit = 50, level?: string) {
  const conds = level ? [eq(operationalEvents.level, level)] : [];
  return db().select().from(operationalEvents).where(conds.length ? and(...conds) : undefined).orderBy(desc(operationalEvents.createdAt)).limit(limit);
}

/* ------------------------------------------------------------------ */
/* Clientes                                                             */
/* ------------------------------------------------------------------ */
export type CustomerRow = { id: string; name: string; email: string; phone: string; status: string; role: string; createdAt: Date; plan: string | null; subStatus: string | null; access: AccessKind | null; endsAt: Date | null; whatsappLinked: boolean };

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
  const access = ids.length ? await currentAccess() : [];
  if (canSeePii && q) await audit(admin.id, "customers.search_pii", null, null, { query: uuid ? "id" : "email" });
  return rows.map((r) => {
    const s = access.find((x) => x.userId === r.u.id);
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
      access: s?.kind ?? null,
      endsAt: s?.endsAt ?? null,
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

/* ------------------------------------------------------------------ */
/* Uso: quem está de fato usando o robô                                 */
/* ------------------------------------------------------------------ */
/**
 * Mede o uso só por sinais de operação (mensagens recebidas no WhatsApp e
 * entradas no painel). Não lê lançamentos, valores nem o texto das mensagens.
 */
export type UsageBucket = "active" | "cooling" | "idle" | "never";
export type UsageRow = {
  userId: string;
  name: string;
  email: string;
  createdAt: Date;
  plan: string | null;
  access: AccessKind | null;
  endsAt: Date | null;
  whatsappLinked: boolean;
  lastMessageAt: Date | null;
  lastLoginAt: Date | null;
  messages7: number;
  messages30: number;
  messagesTotal: number;
  activeDays30: number;
  bucket: UsageBucket;
};

export const USAGE_LABELS: Record<UsageBucket, string> = {
  active: "Usando",
  cooling: "Esfriando",
  idle: "Parou de usar",
  never: "Nunca usou",
};

export const USAGE_HINTS: Record<UsageBucket, string> = {
  active: "Mandou mensagem nos últimos 7 dias",
  cooling: "Última mensagem entre 8 e 30 dias atrás",
  idle: "Mais de 30 dias sem mandar mensagem",
  never: "Nunca mandou mensagem para o robô",
};

/** Acessos que contam como "cliente com acesso liberado" (pagando, testando ou em cortesia). */
export const LIVE_ACCESS: AccessKind[] = ["paid", "card_trial", "trial", "courtesy", "past_due"];

export function usageBucket(lastMessageAt: Date | null, now = new Date()): UsageBucket {
  if (!lastMessageAt) return "never";
  const days = (now.getTime() - lastMessageAt.getTime()) / 86400_000;
  if (days <= 7) return "active";
  if (days <= 30) return "cooling";
  return "idle";
}

export async function usageOverview(canSeePii: boolean, now = new Date()): Promise<UsageRow[]> {
  const d7 = new Date(now.getTime() - 7 * 86400_000);
  const d30 = new Date(now.getTime() - 30 * 86400_000);
  const r = await db().execute<{
    id: string; name: string; email: string; created_at: Date; wa_linked: boolean;
    last_msg: Date | null; msgs7: number | null; msgs30: number | null; msgs_total: number | null; days30: number | null; last_login: Date | null;
  }>(sql`
    select u.id, u.name, u.email, u.created_at,
           exists (select 1 from whatsapp_identities w where w.user_id = u.id) as wa_linked,
           ue.last_msg, ue.msgs7, ue.msgs30, ue.msgs_total, ue.days30, s.last_login
      from users u
      left join (
        select user_id,
               max(created_at) as last_msg,
               count(*) filter (where created_at >= ${d7})::int as msgs7,
               count(*) filter (where created_at >= ${d30})::int as msgs30,
               count(*)::int as msgs_total,
               count(distinct (created_at at time zone 'America/Sao_Paulo')::date) filter (where created_at >= ${d30})::int as days30
          from usage_events
         where type = 'wa_inbound' and user_id is not null
         group by user_id
      ) ue on ue.user_id = u.id
      left join (select user_id, max(created_at) as last_login from sessions group by user_id) s on s.user_id = u.id
     where u.role = 'user' and u.status <> 'deleted'`);
  const access = new Map((await currentAccess()).map((a) => [a.userId, a]));
  return r.rows.map((x) => {
    const a = access.get(x.id);
    const lastMessageAt = x.last_msg ? new Date(x.last_msg) : null;
    return {
      userId: x.id,
      name: canSeePii ? x.name : `${x.name.split(" ")[0].slice(0, 1)}***`,
      email: canSeePii ? x.email : maskEmail(x.email),
      createdAt: new Date(x.created_at),
      plan: a?.plan ?? null,
      access: a?.kind ?? null,
      endsAt: a?.endsAt ?? null,
      whatsappLinked: Boolean(x.wa_linked),
      lastMessageAt,
      lastLoginAt: x.last_login ? new Date(x.last_login) : null,
      messages7: x.msgs7 ?? 0,
      messages30: x.msgs30 ?? 0,
      messagesTotal: x.msgs_total ?? 0,
      activeDays30: x.days30 ?? 0,
      bucket: usageBucket(lastMessageAt, now),
    };
  });
}
