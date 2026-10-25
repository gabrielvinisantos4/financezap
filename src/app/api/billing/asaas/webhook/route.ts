import { handleAsaasWebhook } from "@/server/billing/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 1_000_000) return new Response("payload too large", { status: 413 });
  try {
    const r = await handleAsaasWebhook(raw, req.headers.get("asaas-access-token"));
    return Response.json({ received: r.status === 200 }, { status: r.status });
  } catch {
    // 500 faz o Asaas tentar de novo; o evento foi liberado para reprocessamento
    return Response.json({ received: false }, { status: 500 });
  }
}
