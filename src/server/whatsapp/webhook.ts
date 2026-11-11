import { createHmac } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env";
import { safeEqual } from "../security/crypto";

/**
 * Valida a assinatura X-Hub-Signature-256 (HMAC-SHA256 do corpo BRUTO com a
 * chave secreta do app da Meta). Deve ser feito antes de qualquer parse.
 */
export function verifySignature(rawBody: string | Buffer, header: string | null, appSecret = env().WHATSAPP_APP_SECRET): boolean {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(expected, header);
}

/** Handshake GET do webhook: devolve o challenge se o token conferir. */
export function verifySubscription(params: URLSearchParams, verifyToken = env().WHATSAPP_VERIFY_TOKEN): string | null {
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && verifyToken && token && safeEqual(token, verifyToken) && challenge) return challenge;
  return null;
}

const mediaSchema = z
  .object({ id: z.string(), mime_type: z.string().optional(), caption: z.string().optional(), filename: z.string().optional(), voice: z.boolean().optional() })
  .passthrough();

const messageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string().optional(),
    type: z.string(),
    text: z.object({ body: z.string() }).optional(),
    interactive: z
      .object({
        type: z.string(),
        button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
        list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      })
      .optional(),
    button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
    audio: mediaSchema.optional(),
    image: mediaSchema.optional(),
    document: mediaSchema.optional(),
  })
  .passthrough();

const payloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z
            .object({
              metadata: z.object({ phone_number_id: z.string().optional() }).passthrough().optional(),
              messages: z.array(messageSchema).optional(),
              statuses: z.array(z.object({ id: z.string(), status: z.string(), recipient_id: z.string().optional(), errors: z.array(z.unknown()).optional() }).passthrough()).optional(),
            })
            .passthrough(),
        }),
      ),
    }),
  ),
});

export type MediaKind = "audio" | "image" | "document";
export type MediaRef = { kind: MediaKind; id: string; mimeType: string | null; filename: string | null };

export type NormalizedMessage = {
  waMessageId: string;
  waId: string;
  type: "text" | "button" | "media" | "unsupported";
  originalType: string;
  text: string | null; // texto, título do botão ou legenda da mídia
  buttonId: string | null;
  media: MediaRef | null;
  phoneNumberId: string | null;
};

/** Documentos aceitos como comprovante: PDF e imagens. */
const DOCUMENT_MIME = /^(application\/pdf|image\/(jpeg|png|webp))$/i;

export type NormalizedStatus = { waMessageId: string; status: string; error: string | null };

export function parseWebhook(json: unknown): { messages: NormalizedMessage[]; statuses: NormalizedStatus[] } {
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.object !== "whatsapp_business_account") return { messages: [], statuses: [] };
  const messages: NormalizedMessage[] = [];
  const statuses: NormalizedStatus[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const phoneNumberId = change.value.metadata?.phone_number_id ?? null;
      for (const m of change.value.messages ?? []) {
        let type: NormalizedMessage["type"] = "unsupported";
        let text: string | null = null;
        let buttonId: string | null = null;
        let media: MediaRef | null = null;
        if (m.type === "text" && m.text) {
          type = "text";
          text = m.text.body.slice(0, 4000);
        } else if (m.type === "interactive" && m.interactive) {
          const r = m.interactive.button_reply ?? m.interactive.list_reply;
          if (r) {
            type = "button";
            buttonId = r.id.slice(0, 256);
            text = r.title;
          }
        } else if (m.type === "button" && m.button?.payload) {
          type = "button";
          buttonId = m.button.payload.slice(0, 256);
          text = m.button.text ?? null;
        } else if ((m.type === "audio" || m.type === "image" || m.type === "document") && m[m.type]) {
          const ref = m[m.type]!;
          const mimeType = ref.mime_type ?? null;
          if (m.type !== "document" || (mimeType && DOCUMENT_MIME.test(mimeType))) {
            type = "media";
            media = { kind: m.type, id: ref.id.slice(0, 128), mimeType, filename: ref.filename?.slice(0, 200) ?? null };
            text = ref.caption ? ref.caption.slice(0, 1000) : null;
          }
        }
        messages.push({ waMessageId: m.id, waId: m.from, type, originalType: m.type, text, buttonId, media, phoneNumberId });
      }
      for (const s of change.value.statuses ?? []) {
        statuses.push({ waMessageId: s.id, status: s.status, error: s.errors?.length ? JSON.stringify(s.errors).slice(0, 500) : null });
      }
    }
  }
  return { messages, statuses };
}
