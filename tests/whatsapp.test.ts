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
import { receiptToMessage, type MediaReader, type Receipt } from "@/server/whatsapp/media";

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

  it("sem IA configurada, áudio e comprovante recebem orientação educada", async () => {
    await linkedSubscriber("5544999990010");
    await deliver(waPayload("5544999990010", { type: "audio", audio: { id: "x", mime_type: "audio/ogg; codecs=opus" } }));
    expect(lastReply()).toContain("Ainda não consigo ouvir áudios");
    await deliver(waPayload("5544999990010", { type: "image", image: { id: "y", mime_type: "image/jpeg" } }));
    expect(lastReply()).toContain("Ainda não consigo ler comprovantes");
    await deliver(waPayload("5544999990010", { type: "sticker", sticker: { id: "z" } }));
    expect(lastReply()).toContain("ainda não entendo");
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


/* ------------------------- áudio e comprovantes ------------------------- */

function fakeReader(opts: { transcript?: string; receipt?: Receipt }): MediaReader & { seen: { userName?: string; caption?: string | null } } {
  const seen: { userName?: string; caption?: string | null } = {};
  return {
    seen,
    async download(media) {
      return { data: Buffer.from("x"), mimeType: media.mimeType ?? "image/jpeg" };
    },
    async transcribe() {
      return { text: opts.transcript ?? "", usage: { model: "fake-transcribe", tokensIn: 0, tokensOut: 0, costMicroUsd: 3000 } };
    },
    async readReceipt(_d, _m, ctx) {
      seen.userName = ctx.userName;
      seen.caption = ctx.caption;
      return { receipt: opts.receipt!, usage: { model: "fake-vision", tokensIn: 900, tokensOut: 60, costMicroUsd: 456 } };
    },
  };
}

async function deliverWith(body: string, mediaReader: MediaReader) {
  await ingestWebhook(body, sign(body));
  const rows = await db().select().from(inboundMessages).where(eq(inboundMessages.status, "queued"));
  for (const row of rows) await processInbound(row.id, { finalAttempt: true, interpreter: null, mediaReader });
}

const pixSent: Receipt = { is_financial: true, direction: "expense", amount: 45.9, date: "2026-11-10", counterparty: "Mercado Bom Preço", description: null, payment_method: "pix" };

describe("áudio e comprovantes", () => {
  it("monta a frase do comprovante só quando é seguro", () => {
    expect(receiptToMessage(pixSent)).toBe("paguei 45,90 para Mercado Bom Preço via pix no dia 10/11/2026");
    expect(receiptToMessage({ ...pixSent, direction: "income", counterparty: "João" })).toBe("recebi 45,90 de João via pix no dia 10/11/2026");
    expect(receiptToMessage({ ...pixSent, direction: "unknown" })).toBeNull();
    expect(receiptToMessage({ ...pixSent, amount: null })).toBeNull();
    expect(receiptToMessage({ ...pixSent, is_financial: false })).toBeNull();
  });

  it("reconhece áudio, imagem e PDF no webhook e ignora documento de outro tipo", () => {
    const parse = (msg: Record<string, unknown>) => parseWebhook(JSON.parse(waPayload("5544999990020", msg))).messages[0];
    expect(parse({ type: "audio", audio: { id: "a1", mime_type: "audio/ogg; codecs=opus", voice: true } })).toMatchObject({ type: "media", media: { kind: "audio", id: "a1" } });
    expect(parse({ type: "image", image: { id: "i1", mime_type: "image/jpeg", caption: "almoço" } })).toMatchObject({ type: "media", text: "almoço", media: { kind: "image" } });
    expect(parse({ type: "document", document: { id: "d1", mime_type: "application/pdf", filename: "comprovante.pdf" } })).toMatchObject({ type: "media", media: { kind: "document" } });
    expect(parse({ type: "document", document: { id: "d2", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } })).toMatchObject({ type: "unsupported" });
  });

  it("áudio vira lançamento e a resposta mostra o que foi entendido", async () => {
    const u = await linkedSubscriber("5544999990021");
    await deliverWith(waPayload("5544999990021", { type: "audio", audio: { id: "a2", mime_type: "audio/ogg; codecs=opus" } }), fakeReader({ transcript: "gastei 50 no posto" }));
    expect(lastReply()).toContain('"gastei 50 no posto"');
    const list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
    expect(list[0]).toMatchObject({ kind: "expense", amountCents: 5000 });
  });

  it("print de Pix enviado vira despesa, usando o nome do cliente para decidir a direção", async () => {
    const u = await linkedSubscriber("5544999990022");
    const reader = fakeReader({ receipt: pixSent });
    await deliverWith(waPayload("5544999990022", { type: "image", image: { id: "i2", mime_type: "image/jpeg", caption: "mercado" } }), reader);
    expect(lastReply()).toContain("Li o comprovante");
    expect(reader.seen.userName).toBe(u.name);
    expect(reader.seen.caption).toBe("mercado");
    const list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
    expect(list[0]).toMatchObject({ kind: "expense", amountCents: 4590, occurredOn: "2026-11-10" });
  });

  it("o mesmo comprovante reenviado (mesma mensagem da Meta) não duplica", async () => {
    const u = await linkedSubscriber("5544999990023");
    const body = waPayload("5544999990023", { id: "wamid.REC1", type: "image", image: { id: "i3", mime_type: "image/png" } });
    await deliverWith(body, fakeReader({ receipt: pixSent }));
    await deliverWith(body, fakeReader({ receipt: pixSent }));
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(1);
  });

  it("comprovante sem direção clara: pergunta em vez de registrar", async () => {
    const u = await linkedSubscriber("5544999990024");
    await deliverWith(waPayload("5544999990024", { type: "document", document: { id: "d3", mime_type: "application/pdf" } }), fakeReader({ receipt: { ...pixSent, direction: "unknown" } }));
    expect(lastReply()).toContain("gasto ou um recebimento");
    expect(lastReply()).toContain("gastei 45,90 com Mercado Bom Preço");
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
  });

  it("imagem que não é comprovante não gera lançamento", async () => {
    const u = await linkedSubscriber("5544999990025");
    await deliverWith(waPayload("5544999990025", { type: "image", image: { id: "i4", mime_type: "image/jpeg" } }), fakeReader({ receipt: { ...pixSent, is_financial: false, amount: null } }));
    expect(lastReply()).toContain("Não encontrei um comprovante");
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
  });
});

/* ------------------------- lembrete de vencimento ------------------------- */
import { sendDueReminders } from "@/server/whatsapp/reminders";
import { handleMessage } from "@/server/agent/agent";
import { RuleInterpreter } from "@/server/agent/fallback";

describe("lembrete no dia do vencimento", () => {
  // 10/11/2026 09:00 em São Paulo
  const NOW = new Date("2026-11-10T12:00:00Z");
  const deps = { interpreter: new RuleInterpreter(), now: () => NOW };
  const say = (userId: string, text: string) => handleMessage(userId, { messageId: `wamid.R${++n}`, text }, { aiAllowed: true, advancedReports: true }, deps);

  it("envia uma vez só, no dia; com conversa recente vai texto livre, senão vai o modelo aprovado", async () => {
    const u = await linkedSubscriber("5544999990030");
    await say(u.id, "meu aluguel é 1.200 todo dia 10"); // vence hoje → já vira conta a pagar
    await say(u.id, "internet 120 todo mês dia 12"); // vence em 2 dias → sem lembrete hoje
    dryRunOutbox.length = 0;

    // De madrugada não envia
    expect(await sendDueReminders(new Date("2026-11-10T06:00:00Z"))).toMatchObject({ sent: 0 });

    const r1 = await sendDueReminders(NOW);
    expect(r1.sent).toBe(1);
    const body = dryRunOutbox[0].body as { type: string; text?: { body: string } };
    expect(body.type).toBe("text"); // conversou há pouco (vínculo) → mensagem livre
    expect(body.text?.body).toContain("hoje vence 🏠 *Aluguel* — R$ 1.200,00");

    // Rodar de novo não duplica
    expect((await sendDueReminders(new Date("2026-11-10T15:00:00Z"))).sent).toBe(0);
    expect(dryRunOutbox).toHaveLength(1);

    // "paguei o aluguel" sem valor dá baixa com o valor da conta fixa
    const paid = await say(u.id, "paguei o aluguel");
    expect(paid.reply.text).toContain("Conta fixa paga");
    expect(paid.reply.text).toContain("R$ 1.200,00");
  });

  it("sem conversa nas últimas 24 h usa o modelo aprovado pela Meta", async () => {
    const u = await linkedSubscriber("5544999990031");
    await say(u.id, "meu aluguel é 900 todo dia 10");
    await db().update(inboundMessages).set({ receivedAt: new Date("2026-11-01T12:00:00Z") });
    dryRunOutbox.length = 0;
    await sendDueReminders(NOW);
    const body = dryRunOutbox[0].body as { type: string; template: { name: string; components: { parameters: { text: string }[] }[] } };
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("lembrete_vencimento");
    expect(body.template.components[0].parameters.map((p) => p.text)).toEqual(["Cliente", "Aluguel", "R$ 900,00"]);
  });
});
