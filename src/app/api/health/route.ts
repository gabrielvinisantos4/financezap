import { healthCheck } from "@/server/ops/maintenance";
import { redis, redisEnabled } from "@/server/security/rate-limit";
import { integrations } from "@/server/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, boolean> = { database: false, redis: false };
  let databaseError: string | null = null;
  try {
    checks.database = await healthCheck();
  } catch (err) {
    // Só o código/mensagem do driver (sem a string de conexão) para diagnóstico
    const e = err as { code?: string; message?: string };
    databaseError = `${e.code ?? ""} ${(e.message ?? "").replace(/postgres(ql)?:\/\/[^\s]+/g, "[url]")}`.trim().slice(0, 200);
  }
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
      ...(databaseError ? { databaseError } : {}),
      integrations: { whatsapp: integrations.whatsappConfigured(), openai: integrations.openaiConfigured(), asaas: integrations.asaasConfigured() },
    },
    { status: ok ? 200 : 503 },
  );
}
