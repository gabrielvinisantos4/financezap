import { healthCheck } from "@/server/ops/maintenance";
import { redis, redisEnabled } from "@/server/security/rate-limit";
import { integrations } from "@/server/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean> = { database: false, redis: false };
  try {
    checks.database = await healthCheck();
  } catch {}
  if (redisEnabled()) {
    try {
      checks.redis = (await redis().ping()) === "PONG";
    } catch {}
  }
  const ok = checks.database && (checks.redis || !redisEnabled());
  return Response.json(
    {
      ok,
      checks,
      integrations: { whatsapp: integrations.whatsappConfigured(), openai: integrations.openaiConfigured(), asaas: integrations.asaasConfigured() },
    },
    { status: ok ? 200 : 503 },
  );
}
