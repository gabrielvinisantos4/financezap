import { eq } from "drizzle-orm";
import { env } from "../config/env";
import { db } from "../db/client";
import { outboundMessages } from "../db/schema";
import { recordUsage } from "../billing/entitlements";
import type { Reply } from "../agent/format";

export class WhatsAppSendError extends Error {
  constructor(message: string, public retriable: boolean, public status?: number) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

/** Mensagens "enviadas" em modo dry-run ficam aqui (útil em testes e desenvolvimento). */
export const dryRunOutbox: { to: string; body: Record<string, unknown> }[] = [];

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Monta o corpo da Cloud API: texto simples ou botões de resposta (máx. 3). */
export function buildMessageBody(to: string, reply: Reply): Record<string, unknown> {
  if (reply.buttons?.length) {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: truncate(reply.text, 1024) },
        action: {
          buttons: reply.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: truncate(b.title, 20) } })),
        },
      },
    };
  }
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: truncate(reply.text, 4096) } };
}

/** Envia a resposta. Mensagens com botões cujo texto passa de 1024 caracteres viram texto + botões curtos. */
export async function sendReply(to: string, reply: Reply, userId: string | null): Promise<string[]> {
  const bodies: Record<string, unknown>[] = [];
  if (reply.buttons?.length && reply.text.length > 1024) {
    bodies.push(buildMessageBody(to, { text: reply.text }));
    bodies.push(buildMessageBody(to, { text: "Escolha uma opção:", buttons: reply.buttons }));
  } else {
    bodies.push(buildMessageBody(to, reply));
  }
  const ids: string[] = [];
  for (const body of bodies) ids.push(await sendRaw(to, body, userId));
  return ids;
}

/**
 * Celulares do Brasil às vezes chegam da Meta sem o nono dígito (55 + DDD + 8 dígitos).
 * Retorna o mesmo número com o 9, ou null se não for o caso.
 */
export function brazilWithNinthDigit(waId: string): string | null {
  const m = /^55(\d{2})([6-9]\d{7})$/.exec(waId);
  return m ? `55${m[1]}9${m[2]}` : null;
}

export async function sendRaw(to: string, body: Record<string, unknown>, userId: string | null): Promise<string> {
  try {
    return await sendRawOnce(to, body, userId);
  } catch (err) {
    // 131030 = destinatário fora da lista permitida (número de teste). Tenta o formato com o nono dígito.
    const alt = brazilWithNinthDigit(to);
    if (alt && err instanceof WhatsAppSendError && err.message.includes("131030")) {
      return sendRawOnce(alt, { ...body, to: alt }, userId);
    }
    throw err;
  }
}

async function sendRawOnce(to: string, body: Record<string, unknown>, userId: string | null): Promise<string> {
  const e = env();
  const kind = String(body.type ?? "text");
  if (e.WHATSAPP_DRY_RUN) {
    dryRunOutbox.push({ to, body });
    const id = `dryrun.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    await db().insert(outboundMessages).values({ userId, waId: to, waMessageId: id, kind, status: "dry_run" });
    return id;
  }
  if (!e.WHATSAPP_ACCESS_TOKEN || !e.WHATSAPP_PHONE_NUMBER_ID) {
    throw new WhatsAppSendError("WhatsApp não configurado (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)", false);
  }
  const url = `https://graph.facebook.com/${e.WHATSAPP_GRAPH_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new WhatsAppSendError(`Falha de rede ao enviar mensagem: ${(err as Error).message}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok) {
    const retriable = res.status === 429 || res.status >= 500;
    const msg = `Cloud API ${res.status}: ${json.error?.message ?? "erro"} (code ${json.error?.code ?? "?"})`;
    await db().insert(outboundMessages).values({ userId, waId: to, kind, status: "failed", error: msg.slice(0, 500) });
    throw new WhatsAppSendError(msg, retriable, res.status);
  }
  const id = json.messages?.[0]?.id ?? null;
  await db().insert(outboundMessages).values({ userId, waId: to, waMessageId: id, kind, status: "sent" });
  await recordUsage({ userId, type: "wa_outbound", costMicroUsd: e.WHATSAPP_COST_PER_SERVICE_MESSAGE_USD * 1_000_000 });
  return id ?? "";
}

export async function updateOutboundStatus(waMessageId: string, status: string, error: string | null) {
  await db().update(outboundMessages).set({ status, error }).where(eq(outboundMessages.waMessageId, waMessageId));
}
