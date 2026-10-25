import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { Worker } from "bullmq";
import { closeDb, db, withUser } from "@/server/db/client";
import { inboundMessages, plans, users } from "@/server/db/schema";
import { ingestWebhook } from "@/server/whatsapp/ingest";
import { processInbound } from "@/server/whatsapp/processor";
import { dryRunOutbox } from "@/server/whatsapp/client";
import { createLinkCode } from "@/server/whatsapp/linking";
import { grantManualSubscription } from "@/server/billing/subscriptions";
import { verifySignature, verifySubscription, parseWebhook } from "@/server/whatsapp/webhook";
import { redis, closeRedis } from "@/server/security/rate-limit";
import { INBOUND_QUEUE, closeQueues, queue } from "@/server/queue/queues";
import { listTransactions } from "@/server/finance/queries";
import { resetEnvCache } from "@/server/config/env";
import { makeUser, resetDb } from "./helpers";

const SECRET = "test-app-secret";
let n = 0;

function waPayload(from: string, msg: Record<string, unknown>) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "123456789" }, messages: [{ from, id: msg.id ?? `wamid.T${++n}`, timestamp: "1761336000", ...msg }] } }] }],
  });
}
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
const textMsg = (from: string, body: string, id?: string) => waPayload(from, { type: "text", text: { body }, ...(id ? { id } : {}) });

async function deliver(body: string) {
  const r = await ingestWebhook(body, sign(body));
  const rows = await db().select().from(inboundMessages).where(eq(inboundMessages.status, "queued"));
  for (const row of rows) await processInbound(row.id, { finalAttempt: true, interpreter: null });
  return r;
}
const lastReply = () => {
  const b = dryRunOutbox[dryRunOutbox.length - 1]?.body as { text?: { body: string }; interactive?: { body: { text: string } } };
  return b?.text?.body ?? b?.interactive?.body.text ?? "";
};

async function seedPlan() {
  await db().insert(plans).values({ slug: "basico", name: "Básico", priceMonthlyCents: 1990, priceYearlyCents: 19900, active: true, limits: { monthlyMessages: 5, monthlyAiCalls: 5, maxAccounts: 3, customCategories: false, advancedReports: false } });
}

async function linkedSubscriber(phone: string) {
  const u = await makeUser();
  await grantManualSubscription(u.id, "basico", 30);
  const { code } = await createLinkCode(u.id);
  await deliver(textMsg(phone, `Vincular ${code}`));
  return u;
}

beforeEach(async () => {
  await resetDb();
  await redis().flushdb();
  dryRunOutbox.length = 0;
  await seedPlan();
});
afterAll(async () => {
  await closeQueues();
  await closeRedis();
  await closeDb();
});

describe("webhook da Meta", () => {
  it("valida assinatura e o handshake de verificação", () => {
    const body = textMsg("5544999990000", "oi");
    expect(verifySignature(body, sign(body))).toBe(true);
    expect(verifySignature(body + " ", sign(body))).toBe(false);
    expect(verifySignature(body, null)).toBe(false);
    expect(verifySignature(body, "sha256=" + "0".repeat(64))).toBe(false);
    const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "test-verify-token", "hub.challenge": "42" });
    expect(verifySubscription(ok)).toBe("42");
    const bad = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "42" });
    expect(verifySubscription(bad)).toBeNull();
  });

  it("rejeita webhook com assinatura inválida sem gravar nada", async () => {
    const body = textMsg("5544999990000", "gastei 50 no posto");
    const r = await ingestWebhook(body, "sha256=deadbeef");
    expect(r.status).toBe(401);
    expect(await db().select().from(inboundMessages)).toHaveLength(0);
  });

  it("interpreta botões e ignora payloads estranhos", () => {
    const parsed = parseWebhook(JSON.parse(waPayload("5544", { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "pa:x:yes", title: "Confirmar" } } })));
    expect(parsed.messages[0]).toMatchObject({ type: "button", buttonId: "pa:x:yes" });
    expect(parseWebhook({ foo: 1 })).toEqual({ messages: [], statuses: [] });
  });
});

describe("fluxo de mensagens", () => {
  it("número desconhecido recebe orientação de cadastro (uma vez)", async () => {
    await deliver(textMsg("5544999990001", "oi"));
    expect(lastReply()).toContain("ainda não está vinculado");
    await deliver(textMsg("5544999990001", "oi de novo"));
    expect(dryRunOutbox).toHaveLength(1);
  });

  it("vincula o número com código de uso único e rejeita reuso", async () => {
    const u = await makeUser({ name: "Gabriel Teste" });
    const { code } = await createLinkCode(u.id);
    await deliver(textMsg("5544999990002", `Vincular ${code}`));
    expect(lastReply()).toContain("Pronto, Gabriel");
    await deliver(textMsg("5544999990003", `Vincular ${code}`));
    expect(lastReply()).toContain("Código inválido ou expirado");
  });

  it("sem assinatura ativa não processa lançamentos", async () => {
    const u = await makeUser();
    const { code } = await createLinkCode(u.id);
    await deliver(textMsg("5544999990004", `Vincular ${code}`));
    await deliver(textMsg("5544999990004", "gastei 50 no posto"));
    expect(lastReply()).toContain("não tem uma assinatura ativa");
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
  });

  it("assinante registra despesa pelo WhatsApp de ponta a ponta", async () => {
    const u = await linkedSubscriber("5544999990005");
    await deliver(textMsg("5544999990005", "Gastei 50 reais no posto"));
    expect(lastReply()).toContain("✅ Despesa registrada!");
    const list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ amountCents: 5000, source: "whatsapp" });
    // texto bruto apagado após processar (minimização de dados)
    const [row] = await db().select().from(inboundMessages).where(eq(inboundMessages.status, "processed")).limit(1);
    expect(row.payload).toBeNull();
  });

  it("webhook duplicado (mesmo id da Meta) não duplica lançamento", async () => {
    const u = await linkedSubscriber("5544999990006");
    const body = textMsg("5544999990006", "Comprei 85 reais no mercado", "wamid.DUP1");
    const first = await deliver(body);
    const second = await deliver(body);
    expect(first.accepted).toBe(1);
    expect(second).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(1);
  });

  it("falha no envio: a nova tentativa só reenvia, sem refazer o lançamento", async () => {
    const u = await linkedSubscriber("5544999990007");
    const body = textMsg("5544999990007", "Gastei 30 no lanche");
    await ingestWebhook(body, sign(body));
    const [row] = await db().select().from(inboundMessages).where(eq(inboundMessages.status, "queued"));
    // derruba o envio
    process.env.WHATSAPP_DRY_RUN = "false";
    process.env.WHATSAPP_ACCESS_TOKEN = "";
    resetEnvCache();
    await expect(processInbound(row.id, { finalAttempt: false, interpreter: null })).rejects.toThrow();
    const [mid] = await db().select().from(inboundMessages).where(eq(inboundMessages.id, row.id));
    expect(mid.status).toBe("queued");
    expect(mid.reply).not.toBeNull();
    // volta o envio e reprocessa
    process.env.WHATSAPP_DRY_RUN = "true";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
    resetEnvCache();
    await processInbound(row.id, { finalAttempt: false, interpreter: null });
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(1);
    expect(lastReply()).toContain("Despesa registrada");
  });

  it("bloqueia ao atingir o limite mensal do plano", async () => {
    await linkedSubscriber("5544999990008");
    for (let i = 0; i < 6; i++) await deliver(textMsg("5544999990008", `gastei ${i + 1} no lanche`));
    expect(lastReply()).toContain("limite de 5 mensagens");
  });

  it("cliente bloqueado pelo admin não usa o serviço", async () => {
    const u = await linkedSubscriber("5544999990009");
    await db().update(users).set({ status: "blocked" }).where(eq(users.id, u.id));
    await deliver(textMsg("5544999990009", "gastei 10 no lanche"));
    expect(lastReply()).toContain("suspenso");
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
  });

  it("áudio/imagem recebem orientação educada", async () => {
    await linkedSubscriber("5544999990010");
    await deliver(waPayload("5544999990010", { type: "audio", audio: { id: "x" } }));
    expect(lastReply()).toContain("só mensagens de texto");
  });

  it("fila real (BullMQ + Redis): o worker processa o que chega pelo webhook", async () => {
    const u = await linkedSubscriber("5544999990011");
    await queue(INBOUND_QUEUE).obliterate({ force: true });
    const worker = new Worker(INBOUND_QUEUE, async (job) => processInbound(job.data.inboundId, { finalAttempt: true, interpreter: null }), { connection: redis() });
    try {
      const body = textMsg("5544999990011", "Recebi 600 reais por um vídeo");
      const r = await ingestWebhook(body, sign(body));
      expect(r.accepted).toBe(1);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
        if (list.length) break;
        await new Promise((res) => setTimeout(res, 100));
      }
      const list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
      expect(list[0]).toMatchObject({ kind: "income", amountCents: 60000 });
    } finally {
      await worker.close();
    }
  });
});
