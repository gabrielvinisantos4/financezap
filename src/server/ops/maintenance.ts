import { sql } from "drizzle-orm";
import { db, withSystem } from "../db/client";
import { generateRecurring } from "../finance/engine";
import { addDays, todayIn } from "../finance/dates";
import { expireSubscriptions } from "../billing/subscriptions";
import { requeueStuck } from "../whatsapp/ingest";
import { opEvent } from "./events";

/**
 * Política de retenção (LGPD — minimização):
 *  - texto bruto de mensagens recebidas: apagado após o processamento; restos em 30 dias
 *  - registro técnico de mensagens: 90 dias
 *  - histórico curto de conversa usado como contexto da IA: 7 dias
 *  - pendências, códigos de vínculo e sessões expiradas: 7 dias
 *  - eventos operacionais: 180 dias
 * Dados financeiros ficam enquanto a conta existir (ou até o cliente pedir exclusão).
 */
export async function runRetention() {
  const r = await withSystem(async (tx) => {
    const a = await tx.execute(sql`update inbound_messages set payload = null, reply = null where created_at < now() - interval '30 days' and (payload is not null or reply is not null)`);
    const b = await tx.execute(sql`delete from inbound_messages where created_at < now() - interval '90 days'`);
    const c = await tx.execute(sql`delete from conversation_turns where created_at < now() - interval '7 days'`);
    const d = await tx.execute(sql`delete from pending_actions where created_at < now() - interval '7 days'`);
    const e = await tx.execute(sql`delete from link_codes where created_at < now() - interval '7 days'`);
    const f = await tx.execute(sql`delete from sessions where expires_at < now() - interval '7 days'`);
    const g = await tx.execute(sql`delete from operational_events where created_at < now() - interval '180 days'`);
    const h = await tx.execute(sql`delete from outbound_messages where created_at < now() - interval '90 days'`);
    return { a: a.rowCount, b: b.rowCount, c: c.rowCount, d: d.rowCount, e: e.rowCount, f: f.rowCount, g: g.rowCount, h: h.rowCount };
  });
  await opEvent("info", "maintenance.retention", "Rotina de retenção executada", r);
  return r;
}

/** Gera contas a pagar das recorrências com 7 dias de antecedência. */
export async function runRecurring(now = new Date()) {
  const horizon = addDays(todayIn("America/Sao_Paulo", now), 7);
  const created = await withSystem((tx) => generateRecurring(tx, horizon));
  if (created) await opEvent("info", "maintenance.recurring", "Lançamentos recorrentes gerados", { created });
  return created;
}

export async function runBillingHousekeeping() {
  const expired = await expireSubscriptions();
  if (expired) await opEvent("info", "maintenance.billing", "Assinaturas encerradas por fim de período", { expired });
  return expired;
}

export async function runRequeue() {
  const n = await requeueStuck();
  if (n) await opEvent("warn", "maintenance.requeue", "Mensagens presas reenfileiradas", { count: n });
  return n;
}

export async function healthCheck() {
  await db().execute(sql`select 1`);
  return true;
}

/**
 * Rotinas diárias para quando não há worker (Vercel): contas fixas, assinaturas vencidas
 * e retenção. Roda no máximo uma vez a cada ~20 h, mesmo chamada de vários lugares
 * ao mesmo tempo (trava no banco + marcador em operational_events). Idempotente.
 */
export async function runDailyIfDue(now = new Date()): Promise<boolean> {
  const claimed = await withSystem(async (tx) => {
    const lock = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(7302461) as ok`);
    if (!lock.rows[0]?.ok) return false;
    const recent = await tx.execute(sql`select 1 from operational_events where type = 'maintenance.daily' and created_at > now() - interval '20 hours' limit 1`);
    if (recent.rows.length) return false;
    await tx.execute(sql`insert into operational_events (level, type, message) values ('info', 'maintenance.daily', 'Rotinas diárias iniciadas')`);
    return true;
  });
  if (!claimed) return false;
  await runRecurring(now);
  await runBillingHousekeeping();
  await runRetention();
  return true;
}
