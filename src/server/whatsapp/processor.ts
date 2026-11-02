import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { inboundMessages } from "../db/schema";
import { env, integrations } from "../config/env";
import { handleMessage } from "../agent/agent";
import { OpenAIInterpreter, estimateAiCostMicroUsd, type Interpreter } from "../agent/llm";
import type { Reply } from "../agent/format";
import { FinanceError } from "../finance/errors";
import { getEntitlement, INACTIVE_MESSAGES, monthlyUsage, recordUsage } from "../billing/entitlements";
import { rateLimit, withLock } from "../security/rate-limit";
import { opEvent } from "../ops/events";
import { consumeLinkCode, extractLinkCode, findUserByWaId } from "./linking";
import { sendReply } from "./client";

export type ProcessorDeps = {
  interpreter?: Interpreter | null; // injeção para testes; padrão = OpenAI se configurada
  now?: () => Date;
};

let defaultInterpreter: Interpreter | null | undefined;
function interpreterFromEnv(): Interpreter | null {
  if (defaultInterpreter === undefined) defaultInterpreter = integrations.openaiConfigured() ? new OpenAIInterpreter() : null;
  return defaultInterpreter;
}

export type InboundPayload = { text: string | null; buttonId: string | null; type: "text" | "button" | "unsupported" };

/**
 * Processa uma mensagem recebida. Chamado pelo worker (BullMQ).
 * - Idempotente: mensagens já processadas são ignoradas.
 * - Se a ação já foi executada e só o envio falhou, a nova tentativa apenas reenvia.
 * - Mensagens de um mesmo número são processadas em ordem (trava por número).
 */
export async function processInbound(inboundId: string, opts: { finalAttempt: boolean } & ProcessorDeps = { finalAttempt: true }): Promise<"processed" | "ignored" | "skipped"> {
  const [row] = await db().select().from(inboundMessages).where(eq(inboundMessages.id, inboundId));
  if (!row) return "skipped";
  if (row.status === "processed" || row.status === "ignored" || row.status === "failed") return "skipped";

  return withLock(`wa:${row.waId}`, 60_000, async () => {
    // relê dentro da trava
    const [current] = await db().select().from(inboundMessages).where(eq(inboundMessages.id, inboundId));
    if (!current || current.status === "processed" || current.status === "ignored" || current.status === "failed") return "skipped";
    await db().update(inboundMessages).set({ status: "processing", attempts: sql`${inboundMessages.attempts} + 1` }).where(eq(inboundMessages.id, inboundId));

    try {
      let reply = current.reply as Reply | null;
      let userId = current.userId;
      if (!reply) {
        const outcome = await decideReply(current.waId, current.waMessageId, current.payload as InboundPayload, opts);
        if (outcome === null) {
          await db().update(inboundMessages).set({ status: "ignored", processedAt: new Date(), payload: null }).where(eq(inboundMessages.id, inboundId));
          return "ignored";
        }
        reply = outcome.reply;
        userId = outcome.userId;
        // Persistimos a resposta ANTES de enviar: se o envio falhar, não refazemos a ação
        await db().update(inboundMessages).set({ reply, userId }).where(eq(inboundMessages.id, inboundId));
      }
      await sendReply(current.waId, reply, userId);
      await db()
        .update(inboundMessages)
        .set({ status: "processed", processedAt: new Date(), error: null, payload: null })
        .where(eq(inboundMessages.id, inboundId));
      return "processed";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.finalAttempt) {
        await db().update(inboundMessages).set({ status: "failed", error: message.slice(0, 500) }).where(eq(inboundMessages.id, inboundId));
        await opEvent("error", "inbound.failed", "Falha definitiva ao processar mensagem", { inboundId, error: message.slice(0, 300) }, current.userId);
        // Avisa o cliente uma vez, sem detalhes técnicos
        await sendReply(current.waId, { text: "Desculpe, tive um problema para processar sua última mensagem. 😕 Nada foi alterado. Pode tentar de novo em alguns minutos?" }, current.userId).catch(() => undefined);
      } else {
        await db().update(inboundMessages).set({ status: "queued", error: message.slice(0, 500) }).where(eq(inboundMessages.id, inboundId));
        await opEvent("warn", "inbound.retry", "Erro ao processar mensagem; nova tentativa agendada", { inboundId, error: message.slice(0, 300) }, current.userId);
      }
      throw err;
    }
  });
}

async function decideReply(waId: string, waMessageId: string, payload: InboundPayload, opts: ProcessorDeps): Promise<{ reply: Reply; userId: string | null } | null> {
  const appUrl = env().APP_URL;

  // Proteção contra abuso por número
  if (!(await rateLimit(`wa-msg:${waId}`, 20, 60))) {
    await opEvent("warn", "abuse.rate_limited", "Número excedeu o limite de mensagens por minuto", { waIdSuffix: waId.slice(-4) });
    return null;
  }

  const userId = await findUserByWaId(waId);

  // Número ainda não vinculado
  if (!userId) {
    const code = extractLinkCode(payload.text);
    if (code) {
      if (!(await rateLimit(`link-try:${waId}`, 5, 3600)) || !(await rateLimit("link-try:global", 300, 3600))) {
        return { reply: { text: "Muitas tentativas de vínculo. Aguarde um pouco e gere um novo código no painel." }, userId: null };
      }
      const r = await consumeLinkCode(waId, code);
      if (r.ok) {
        await opEvent("info", "whatsapp.linked", "Número vinculado a uma conta", undefined, r.userId);
        return {
          reply: {
            text: `✅ Pronto${r.name ? `, ${r.name.split(" ")[0]}` : ""}! Seu WhatsApp foi vinculado ao FinanceZap.\n\nAgora é só me contar seus gastos e recebimentos, do seu jeito. Por exemplo:\n• "Gastei 50 no posto"\n• "Recebi 1.200 de um cliente"\n• "Quanto gastei este mês?"\n\nDigite *ajuda* quando quiser ver mais exemplos.`,
          },
          userId: r.userId,
        };
      }
      const why = r.reason === "number_in_use" ? "Este número já está vinculado a outra conta." : "Código inválido ou expirado. Gere um novo código no painel.";
      return { reply: { text: `❌ ${why}` }, userId: null };
    }
    // Responde no máximo uma vez a cada 12h para números desconhecidos
    if (!(await rateLimit(`unknown:${waId}`, 1, 12 * 3600))) return null;
    return {
      reply: { text: `Olá! 👋 Eu sou o FinanceZap, um assistente financeiro no WhatsApp.\n\nEste número ainda não está vinculado a uma conta. Para começar, crie sua conta e escolha um plano em:\n${appUrl}\n\nSe você já é cliente, abra o painel e toque em "Vincular WhatsApp".` },
      userId: null,
    };
  }

  return replyForLinkedUser(userId, waMessageId, payload, opts);
}

/**
 * Atendimento de um cliente já identificado: assinatura, limites do plano e agente.
 * Usado pelo WhatsApp e pelo simulador do painel (mesmas regras).
 */
export async function replyForLinkedUser(userId: string, waMessageId: string, payload: InboundPayload, opts: ProcessorDeps): Promise<{ reply: Reply; userId: string | null } | null> {
  const appUrl = env().APP_URL;
  await recordUsage({ userId, type: "wa_inbound" });

  const ent = await getEntitlement(userId, opts.now?.() ?? new Date());
  if (!ent.active) {
    if (!(await rateLimit(`inactive:${userId}`, 1, 3600))) return null;
    const suffix = ent.reason === "deleted" ? "" : `${appUrl}/app/assinatura`;
    return { reply: { text: INACTIVE_MESSAGES[ent.reason] + suffix }, userId };
  }

  const usage = await monthlyUsage(userId, opts.now?.() ?? new Date());
  if (usage.messages > ent.limits.monthlyMessages) {
    if (!(await rateLimit(`limit:${userId}`, 1, 24 * 3600))) return null;
    return { reply: { text: `Você atingiu o limite de ${ent.limits.monthlyMessages} mensagens deste mês no plano ${ent.planName}. Seus dados continuam disponíveis no painel, e você pode mudar de plano em ${appUrl}/app/assinatura.` }, userId };
  }

  if (payload.type === "unsupported") {
    return { reply: { text: "Por enquanto eu entendo só mensagens de texto. ✍️ Escreva, por exemplo: \"gastei 50 no posto\"." }, userId };
  }

  const interpreter = opts.interpreter === undefined ? interpreterFromEnv() : opts.interpreter;
  try {
    const result = await handleMessage(
      userId,
      { messageId: waMessageId, text: payload.text, buttonId: payload.buttonId },
      { aiAllowed: usage.aiCalls < ent.limits.monthlyAiCalls, advancedReports: ent.limits.advancedReports },
      {
        interpreter,
        now: opts.now,
        onAiUsage: async (u) => recordUsage({ userId, type: "ai_call", tokensIn: u.tokensIn, tokensOut: u.tokensOut, model: u.model, costMicroUsd: estimateAiCostMicroUsd(u.tokensIn, u.tokensOut) }),
        onAiError: async (e) => opEvent("warn", "ai.error", "Falha na interpretação por IA; usada contingência", { error: String((e as Error)?.message ?? e).slice(0, 200) }, userId),
      },
    );
    return { reply: result.reply, userId };
  } catch (err) {
    if (err instanceof FinanceError) return { reply: { text: err.userMessage }, userId };
    throw err;
  }
}
