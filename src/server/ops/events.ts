import { db } from "../db/client";
import { operationalEvents } from "../db/schema";
import { log } from "../log";

/**
 * Registro de eventos operacionais (falhas, alertas) visível no painel admin.
 * Nunca incluir conteúdo de mensagens ou valores financeiros em `meta`.
 */
export async function opEvent(level: "info" | "warn" | "error", type: string, message: string, meta?: Record<string, unknown>, userId?: string | null) {
  log[level]({ type, userId, ...meta }, message);
  try {
    await db().insert(operationalEvents).values({ level, type, message: message.slice(0, 500), meta: meta ?? null, userId: userId ?? null });
  } catch (err) {
    log.error({ err }, "falha ao registrar evento operacional");
  }
}
