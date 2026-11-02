import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { inboundMessages } from "../db/schema";
import { parseWebhook, verifySignature } from "./webhook";
import { updateOutboundStatus } from "./client";
import { enqueueInbound } from "../queue/queues";
import { opEvent } from "../ops/events";
import { redisEnabled } from "../security/rate-limit";

export type IngestResult = { status: 200 | 401; accepted: number; duplicates: number; statuses: number; inline?: string[] };

/**
 * Entrada do webhook: valida assinatura, persiste cada mensagem uma única vez
 * (chave única no id da Meta) e enfileira o processamento. Responde rápido;
 * todo o trabalho pesado acontece no worker.
 */
export async function ingestWebhook(rawBody: string, signature: string | null): Promise<IngestResult> {
  if (!verifySignature(rawBody, signature)) {
    await opEvent("warn", "webhook.invalid_signature", "Webhook do WhatsApp com assinatura inválida");
    return { status: 401, accepted: 0, duplicates: 0, statuses: 0 };
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 200, accepted: 0, duplicates: 0, statuses: 0 };
  }
  const { messages, statuses } = parseWebhook(json);
  let accepted = 0;
  let duplicates = 0;
  // Sem Redis (ex.: Vercel sem worker), quem chamou processa as mensagens logo após responder à Meta.
  const inline: string[] = [];
  for (const m of messages) {
    const inserted = await db()
      .insert(inboundMessages)
      .values({
        waMessageId: m.waMessageId,
        waId: m.waId,
        type: m.type === "unsupported" ? m.originalType : m.type,
        payload: { text: m.text, buttonId: m.buttonId, type: m.type },
      })
      .onConflictDoNothing({ target: inboundMessages.waMessageId })
      .returning({ id: inboundMessages.id });
    if (!inserted.length) {
      duplicates++;
      continue;
    }
    accepted++;
    if (!redisEnabled()) {
      inline.push(inserted[0].id);
      continue;
    }
    try {
      await enqueueInbound(inserted[0].id);
    } catch (err) {
      // Fica "queued" no banco; a rotina de varredura reenfileira depois
      await opEvent("error", "queue.enqueue_failed", "Falha ao enfileirar mensagem", { inboundId: inserted[0].id, err: String(err) });
    }
  }
  for (const s of statuses) {
    await updateOutboundStatus(s.waMessageId, s.status, s.error);
    if (s.status === "failed") await opEvent("warn", "whatsapp.delivery_failed", "Mensagem não entregue pelo WhatsApp", { waMessageId: s.waMessageId, error: s.error });
  }
  return { status: 200, accepted, duplicates, statuses: statuses.length, inline };
}

/** Reenfileira mensagens que ficaram presas (ex.: Redis fora do ar no momento do webhook). */
export async function requeueStuck(olderThanMinutes = 2): Promise<number> {
  const rows = await db().execute<{ id: string }>(sql`
    select id from inbound_messages
     where status in ('queued','processing') and received_at < now() - make_interval(mins => ${olderThanMinutes})
       and attempts < 5
     order by received_at limit 100`);
  for (const r of rows.rows) await enqueueInbound(r.id);
  return rows.rows.length;
}
