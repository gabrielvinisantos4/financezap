/**
 * Teste de fumaça contra um servidor rodando (local ou staging):
 *   SMOKE_URL=http://localhost:3000 WHATSAPP_VERIFY_TOKEN=... npx tsx scripts/smoke.ts
 * Verifica saúde, proteção de rotas e rejeição de webhooks sem credencial.
 */
const base = process.env.SMOKE_URL ?? "http://localhost:3000";
const verify = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
let failed = 0;

async function check(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    console.log(`${ok ? "✔" : "✘"} ${name}`);
    if (!ok) failed++;
  } catch (e) {
    console.log(`✘ ${name}: ${(e as Error).message}`);
    failed++;
  }
}

const get = (p: string, init?: RequestInit) => fetch(base + p, { redirect: "manual", ...init });

async function main() {
  await check("health responde 200", async () => (await get("/api/health")).status === 200);
  await check("página inicial responde 200", async () => (await get("/")).status === 200);
  await check("painel sem login redireciona para /entrar", async () => {
    const r = await get("/app");
    return [303, 307, 308].includes(r.status) && (r.headers.get("location") ?? "").includes("/entrar");
  });
  await check("admin sem login devolve 404", async () => (await get("/admin")).status === 404);
  await check("CSV sem login devolve 401", async () => (await get("/app/relatorios/csv")).status === 401);
  await check("exportação sem login devolve 401", async () => (await get("/app/conta/exportar")).status === 401);
  await check("webhook do WhatsApp: token de verificação errado = 403", async () => (await get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1")).status === 403);
  if (verify)
    await check("webhook do WhatsApp: verificação correta devolve o challenge", async () => (await (await get(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verify)}&hub.challenge=4242`)).text()) === "4242");
  await check("webhook do WhatsApp sem assinatura = 401", async () => (await get("/api/whatsapp/webhook", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status === 401);
  await check("webhook do Asaas sem token = 401", async () => (await get("/api/billing/asaas/webhook", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status === 401);
  console.log(failed ? `\n${failed} verificação(ões) falharam` : "\nTudo certo.");
  process.exit(failed ? 1 : 0);
}
main();
