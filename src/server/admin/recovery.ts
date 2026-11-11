import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../db/client";
import { affiliates, subscriptions, users } from "../db/schema";
import { env } from "../config/env";
import { FinanceError } from "../finance/errors";
import { opEvent } from "../ops/events";
import { sendRaw, WhatsAppSendError } from "../whatsapp/client";

/** Não manda de novo para a mesma pessoa antes disso (evita parecer spam e bloqueio na Meta). */
export const RECOVERY_COOLDOWN_DAYS = 3;
export const RECOVERY_MAX = 3;

export type StalledSignup = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  stage: "account_only" | "checkout_abandoned";
  recoverySentAt: Date | null;
  recoveryCount: number;
  canSend: boolean;
  blockedReason: string | null;
};

/**
 * Quem criou a conta e nunca virou cliente: sem assinatura liberada, sem teste com cartão
 * e sem cortesia. Afiliados que só vieram pegar o link ficam de fora.
 */
export async function listStalledSignups(now = new Date(), days = 60): Promise<StalledSignup[]> {
  const since = new Date(now.getTime() - days * 86400_000);
  const until = new Date(now.getTime() - 30 * 60_000); // dá meia hora para a pessoa terminar sozinha
  const candidates = await db()
    .select()
    .from(users)
    .where(and(eq(users.role, "user"), eq(users.status, "active"), isNull(users.deletedAt), gte(users.createdAt, since), lte(users.createdAt, until)))
    .orderBy(desc(users.createdAt));
  if (!candidates.length) return [];
  const ids = candidates.map((u) => u.id);
  const subs = await db().select().from(subscriptions).where(inArray(subscriptions.userId, ids));
  const affs = await db().select({ userId: affiliates.userId }).from(affiliates).where(inArray(affiliates.userId, ids));
  const affiliateIds = new Set(affs.map((a) => a.userId));
  const cooldown = RECOVERY_COOLDOWN_DAYS * 86400_000;

  const out: StalledSignup[] = [];
  for (const u of candidates) {
    if (affiliateIds.has(u.id)) continue;
    const mine = subs.filter((s) => s.userId === u.id);
    const becameCustomer = mine.some((s) => s.provider === "manual" || s.providerSubscriptionId !== null || ["active", "past_due", "canceled"].includes(s.status));
    if (becameCustomer) continue;
    const blockedReason = !u.phoneE164
      ? "Sem WhatsApp no cadastro"
      : u.recoveryCount >= RECOVERY_MAX
        ? `Já recebeu ${RECOVERY_MAX} mensagens`
        : u.recoverySentAt && now.getTime() - u.recoverySentAt.getTime() < cooldown
          ? `Aguarde ${RECOVERY_COOLDOWN_DAYS} dias entre mensagens`
          : null;
    out.push({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phoneE164 ? (/^\d{10,11}$/.test(u.phoneE164) ? `55${u.phoneE164}` : u.phoneE164) : null,
      createdAt: u.createdAt,
      stage: mine.length ? "checkout_abandoned" : "account_only",
      recoverySentAt: u.recoverySentAt,
      recoveryCount: u.recoveryCount,
      canSend: blockedReason === null,
      blockedReason,
    });
  }
  return out;
}

/** Corpo do modelo aprovado: "Olá, {{1}}! ..." com botão de link para continuar. */
export function recoveryTemplateBody(to: string, firstName: string) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: env().RECOVERY_TEMPLATE_NAME,
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: [{ type: "text", text: firstName || "tudo bem" }] }],
    },
  };
}

export async function sendRecoveryMessage(userId: string, adminId: string, now = new Date()) {
  const list = await listStalledSignups(now, 365);
  const target = list.find((s) => s.id === userId);
  if (!target) throw new FinanceError("not_found", "Essa pessoa já virou cliente ou não está mais na lista.");
  if (!target.canSend || !target.phone) throw new FinanceError("invalid", target.blockedReason ?? "Não dá para enviar agora.");

  // Marca antes de enviar: dois cliques não mandam duas mensagens
  const [locked] = await db()
    .update(users)
    .set({ recoverySentAt: now, recoveryCount: target.recoveryCount + 1 })
    .where(and(eq(users.id, userId), eq(users.recoveryCount, target.recoveryCount)))
    .returning({ id: users.id });
  if (!locked) throw new FinanceError("conflict", "A mensagem já está sendo enviada.");

  const firstName = target.name.trim().split(/\s+/)[0] ?? "";
  try {
    await sendRaw(target.phone, recoveryTemplateBody(target.phone, firstName), userId);
    await opEvent("info", "recovery.sent", "Mensagem de retomada de cadastro enviada", { stage: target.stage, by: adminId }, userId);
  } catch (err) {
    // Desfaz a marcação para poder tentar de novo
    await db().update(users).set({ recoverySentAt: target.recoverySentAt, recoveryCount: target.recoveryCount }).where(eq(users.id, userId));
    const msg = err instanceof Error ? err.message : String(err);
    await opEvent("warn", "recovery.failed", "Falha ao enviar retomada de cadastro", { error: msg.slice(0, 300) }, userId);
    if (err instanceof WhatsAppSendError && /132001|template|modelo/i.test(msg)) {
      throw new FinanceError("invalid", `O modelo "${env().RECOVERY_TEMPLATE_NAME}" ainda não está aprovado na Meta. Assim que aprovar, o envio funciona.`);
    }
    throw new FinanceError("invalid", "O WhatsApp não aceitou a mensagem agora. Tente de novo mais tarde.");
  }
}
