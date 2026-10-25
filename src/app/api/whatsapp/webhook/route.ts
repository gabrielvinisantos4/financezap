import { ingestWebhook } from "@/server/whatsapp/ingest";
import { verifySubscription } from "@/server/whatsapp/webhook";
import { rateLimit } from "@/server/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Handshake de verificação da Meta
export async function GET(req: Request) {
  const challenge = verifySubscription(new URL(req.url).searchParams);
  if (!challenge) return new Response("forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

// Eventos (mensagens e status). Corpo bruto é necessário para validar a assinatura.
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit(`wa-webhook:${ip}`, 600, 60))) return new Response("too many requests", { status: 429 });
  const raw = await req.text();
  if (raw.length > 3_500_000) return new Response("payload too large", { status: 413 });
  const result = await ingestWebhook(raw, req.headers.get("x-hub-signature-256"));
  return new Response(result.status === 200 ? "ok" : "invalid signature", { status: result.status });
}
