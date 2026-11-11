import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, withUser } from "@/server/db/client";
import { handleMessage, type AgentDeps } from "@/server/agent/agent";
import { RuleInterpreter, interpretByRules } from "@/server/agent/fallback";
import { AIError, type Interpreter } from "@/server/agent/llm";
import { emptyInterpretation, interpretationSchema, type Interpretation } from "@/server/agent/schema";
import { periodSummary, listTransactions, totalsByCategory } from "@/server/finance/queries";
import { resolvePeriod } from "@/server/finance/dates";
import { createAccount } from "@/server/finance/engine";
import { makeUser, resetDb, TODAY } from "./helpers";

// 24/10/2026 15:00 em São Paulo
const NOW = new Date("2026-10-24T18:00:00Z");
const caps = { aiAllowed: true, advancedReports: true };
const rules: AgentDeps = { interpreter: new RuleInterpreter(), now: () => NOW };
let seq = 0;
const send = (userId: string, text: string, deps: AgentDeps = rules) => handleMessage(userId, { messageId: `wamid.${++seq}`, text }, caps, deps);
const press = (userId: string, buttonId: string) => handleMessage(userId, { messageId: `wamid.${++seq}`, buttonId }, caps, rules);
const month = resolvePeriod({ type: "this_month" }, TODAY);

beforeEach(resetDb);
afterAll(closeDb);

describe("interpretação por regras (contingência)", () => {
  const i = (t: string) => interpretByRules(t, { today: TODAY });
  it("entende os exemplos da especificação", () => {
    expect(i("Hoje gastei 50 reais no posto.").entries[0]).toMatchObject({ kind: "expense", amount: 50, category: "combustivel", merchant: "posto" });
    expect(i("Recebi mil reais de um cliente de marketing.").entries[0]).toMatchObject({ kind: "income", amount: 1000, category: "marketing" });
    expect(i("Paguei 120 reais de energia.").entries[0]).toMatchObject({ kind: "expense", amount: 120, category: "agua-energia" });
    expect(i("Comprei 85 reais no mercado.").entries[0]).toMatchObject({ amount: 85, category: "mercado" });
    expect(i("Recebi 600 reais por um vídeo.").entries[0]).toMatchObject({ kind: "income", amount: 600, category: "video" });
    expect(i("Quanto gastei hoje?").query).toMatchObject({ type: "expenses_total", period: { type: "today" } });
    expect(i("Quanto entrou este mês?").query).toMatchObject({ type: "income_total", period: { type: "this_month" } });
    expect(i("Quanto gastei com combustível em outubro?").query).toMatchObject({ type: "category_total", category: "combustivel", period: { type: "month", month: 10 } });
    expect(i("Quanto tenho disponível?").query?.type).toBe("balance");
    expect(i("Mostra meus últimos dez lançamentos.").query).toMatchObject({ type: "recent", limit: 10 });
    expect(i("Qual foi minha maior despesa este mês?").query?.type).toBe("largest_expense");
    expect(i("Quanto recebi de cada cliente?").query?.type).toBe("by_client");
    expect(i("Errei o valor, era 70 reais.")).toMatchObject({ intent: "correct", changes: { amount: 70 } });
    expect(i("Não foi no posto, foi no mercado.")).toMatchObject({ intent: "correct", changes: { merchant: "mercado", category: "mercado" } });
    expect(i("Apaga o último gasto.")).toMatchObject({ intent: "delete", target: { reference: "last_expense" } });
    expect(i("Exclui aquele lançamento de 50 reais.")).toMatchObject({ intent: "delete", target: { reference: "match", amount: 50 } });
    expect(i("Registrei duas vezes a mesma despesa.")).toMatchObject({ intent: "delete", target: { reference: "duplicate" } });
    expect(i("Corrige o valor da última receita para 1.200 reais.")).toMatchObject({ intent: "correct", target: { reference: "last_income" }, changes: { amount: 1200 } });
    expect(i("gastei no mercado")).toMatchObject({ intent: "record", entries: [{ amount: null }] });
  });

  it("separa vários lançamentos na mesma mensagem", () => {
    const two = i("Recebi 800 da farmácia\nRecebi 796 do sindicato");
    expect(two.intent).toBe("record");
    expect(two.entries).toHaveLength(2);
    expect(two.entries[0]).toMatchObject({ kind: "income", amount: 800, counterparty: "farmácia", description: "Farmácia" });
    expect(two.entries[1]).toMatchObject({ kind: "income", amount: 796, counterparty: "sindicato", description: "Sindicato" });

    expect(i("Gastei 50 no posto e paguei 120 de energia").entries).toMatchObject([
      { kind: "expense", amount: 50, category: "combustivel" },
      { kind: "expense", amount: 120, category: "agua-energia" },
    ]);
    expect(i("Gastei 50 no posto; recebi 300 do cliente").entries.map((e) => e.kind)).toEqual(["expense", "income"]);
    // linha sem verbo herda o tipo da anterior
    expect(i("Gastei 50 no posto\n85 no mercado").entries).toMatchObject([
      { kind: "expense", amount: 50 },
      { kind: "expense", amount: 85, category: "mercado" },
    ]);
    // nome com quebra de linha não é mais engolido pela linha seguinte
    expect(i("Recebi 800 da farmácia \n").entries[0]).toMatchObject({ counterparty: "farmácia", description: "Farmácia" });
    expect(i("Gastei 10 no a\nGastei 10 no b\nGastei 10 no c\nGastei 10 no d\nGastei 10 no e\nGastei 10 no f")).toMatchObject({ intent: "record", entries: [] });
  });
});

describe("agente financeiro (ponta a ponta no banco)", () => {
  it("registra despesa com a resposta no formato combinado e a data real", async () => {
    const u = await makeUser();
    const r = await send(u.id, "Gastei 50 reais no posto.");
    expect(r.reply.text).toContain("✅ Despesa registrada!");
    expect(r.reply.text).toContain("⛽ Combustível");
    expect(r.reply.text).toContain("💰 R$ 50,00");
    expect(r.reply.text).toContain("📅 Data: 24/10/2026");
    const s = await withUser(u.id, (tx) => periodSummary(tx, u.id, month));
    expect(s.expenseCents).toBe(5000);
  });

  it("registra e confirma todos os lançamentos de uma mensagem com várias linhas", async () => {
    const u = await makeUser();
    const r = await send(u.id, "Recebi 800 da farmácia\nRecebi 796 do sindicato");
    expect(r.reply.text).toContain("✅ 2 lançamentos registrados!");
    expect(r.reply.text).toContain("Farmácia · +R$ 800,00");
    expect(r.reply.text).toContain("Sindicato · +R$ 796,00");
    const s = await withUser(u.id, (tx) => periodSummary(tx, u.id, month));
    expect(s.incomeCents).toBe(159600);
  });

  it("a mesma mensagem reprocessada não duplica o lançamento", async () => {
    const u = await makeUser();
    const m = { messageId: "wamid.repetida", text: "Comprei 85 reais no mercado" };
    await handleMessage(u.id, m, caps, rules);
    await handleMessage(u.id, m, caps, rules);
    const list = await withUser(u.id, (tx) => listTransactions(tx, u.id, { limit: 50 }));
    expect(list).toHaveLength(1);
  });

  it("pergunta o valor quando falta e registra com a resposta", async () => {
    const u = await makeUser();
    const r1 = await send(u.id, "gastei no mercado");
    expect(r1.reply.text).toMatch(/valor/i);
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
    const r2 = await send(u.id, "85,50");
    expect(r2.reply.text).toContain("R$ 85,50");
    expect((await withUser(u.id, (tx) => periodSummary(tx, u.id, month))).expenseCents).toBe(8550);
  });

  it("responde consultas com números calculados pelo banco", async () => {
    const u = await makeUser();
    await send(u.id, "Gastei 50 reais no posto");
    await send(u.id, "Comprei 85 reais no mercado");
    await send(u.id, "Recebi mil reais de um cliente de marketing");
    await send(u.id, "Recebi 600 reais por um vídeo");
    expect((await send(u.id, "Quanto gastei hoje?")).reply.text).toContain("R$ 135,00");
    expect((await send(u.id, "Quanto entrou este mês?")).reply.text).toContain("R$ 1.600,00");
    expect((await send(u.id, "Quanto gastei com combustível em outubro?")).reply.text).toContain("R$ 50,00");
    expect((await send(u.id, "Qual foi minha maior despesa este mês?")).reply.text).toContain("R$ 85,00");
    const bal = (await send(u.id, "Quanto tenho disponível?")).reply.text;
    expect(bal).toContain("Disponível nas contas: R$ 1.465,00");
    const recent = (await send(u.id, "Mostra meus últimos dez lançamentos")).reply.text;
    expect(recent.split("\n").filter((l) => /^\d+\./.test(l))).toHaveLength(4);
    const clients = (await send(u.id, "Quanto recebi de cada cliente?")).reply.text;
    expect(clients).toContain("R$ 1.000,00");
  });

  it("corrige o último gasto somente após confirmação e não executa duas vezes", async () => {
    const u = await makeUser();
    await send(u.id, "Gastei 50 reais no posto");
    const r = await send(u.id, "Errei o valor, era 70 reais.");
    expect(r.reply.text).toContain("R$ 50,00 → R$ 70,00");
    expect(r.reply.buttons).toHaveLength(2);
    // ainda não alterou
    expect((await withUser(u.id, (tx) => periodSummary(tx, u.id, month))).expenseCents).toBe(5000);
    const yes = r.reply.buttons![0].id;
    const done = await press(u.id, yes);
    expect(done.reply.text).toContain("corrigido");
    expect((await withUser(u.id, (tx) => periodSummary(tx, u.id, month))).expenseCents).toBe(7000);
    const again = await press(u.id, yes);
    expect(again.reply.text).toContain("já foi feito");
    expect((await withUser(u.id, (tx) => periodSummary(tx, u.id, month))).expenseCents).toBe(7000);
  });

  it("troca local e categoria ('não foi no posto, foi no mercado') com confirmação por texto", async () => {
    const u = await makeUser();
    await send(u.id, "Gastei 50 reais no posto");
    const r = await send(u.id, "Não foi no posto, foi no mercado.");
    expect(r.reply.text).toContain("Combustível → Mercado");
    await send(u.id, "sim");
    const cats = await withUser(u.id, (tx) => totalsByCategory(tx, u.id, month, "expense"));
    expect(cats.map((c) => c.slug)).toEqual(["mercado"]);
  });

  it("exclui o último gasto após confirmação; cancelar não altera nada", async () => {
    const u = await makeUser();
    await send(u.id, "Gastei 50 reais no posto");
    await send(u.id, "Comprei 85 reais no mercado");
    const r1 = await send(u.id, "Apaga o último gasto.");
    expect(r1.reply.text).toContain("Mercado");
    expect((await send(u.id, "não")).reply.text).toContain("cancelei");
    expect((await withUser(u.id, (tx) => periodSummary(tx, u.id, month))).expenseCents).toBe(13500);
    await send(u.id, "Apaga o último gasto.");
    expect((await send(u.id, "sim")).reply.text).toContain("excluído");
    expect((await withUser(u.id, (tx) => periodSummary(tx, u.id, month))).expenseCents).toBe(5000);
  });

  it("havendo ambiguidade, apresenta opções para o cliente escolher", async () => {
    const u = await makeUser();
    await send(u.id, "Gastei 50 reais no posto");
    await send(u.id, "Gastei 50 reais na farmácia");
    const r = await send(u.id, "Exclui aquele lançamento de 50 reais.");
    expect(r.reply.text).toContain("Qual deles?");
    expect(r.reply.buttons).toHaveLength(2);
    const pick = await press(u.id, r.reply.buttons![1].id);
    expect(pick.reply.text).toContain("Confirma a exclusão?");
    await press(u.id, pick.reply.buttons![0].id);
    const left = await withUser(u.id, (tx) => listTransactions(tx, u.id));
    expect(left).toHaveLength(1);
  });

  it("detecta lançamento registrado duas vezes", async () => {
    const u = await makeUser();
    await send(u.id, "Comprei 85 reais no mercado");
    await send(u.id, "Comprei 85 reais no mercado");
    const r = await send(u.id, "Registrei duas vezes a mesma despesa.");
    expect(r.reply.text).toContain("repetido");
    await send(u.id, "sim");
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(1);
  });

  it("'sim' sem nada pendente não executa nada", async () => {
    const u = await makeUser();
    const r = await send(u.id, "sim");
    expect(r.reply.text).toContain("Não há nada aguardando");
  });

  it("botão forjado de outro cliente não tem efeito", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await send(a.id, "Gastei 50 reais no posto");
    const r = await send(a.id, "Apaga o último gasto");
    const forged = await press(b.id, r.reply.buttons![0].id);
    expect(forged.reply.text).toContain("não está mais disponível");
    expect(await withUser(a.id, (tx) => listTransactions(tx, a.id))).toHaveLength(1);
  });

  it("compra parcelada no cartão citado pelo nome", async () => {
    const u = await makeUser();
    await withUser(u.id, (tx) => createAccount(tx, u.id, { name: "Nubank", type: "credit_card", closingDay: 1, dueDay: 8 }, 10));
    const ai: Interpreter = {
      name: "fake",
      interpret: async () => ({
        interpretation: emptyInterpretation("record", {
          confidence: 0.95,
          entries: [{ kind: "expense", amount: 300, description: "Fone de ouvido", merchant: null, counterparty: null, category: "compras-pessoais", date: null, payment_method: "credito", installments: 3, account_hint: "nubank" }],
        }),
        usage: { model: "fake", tokensIn: 10, tokensOut: 5 },
      }),
    };
    const r = await send(u.id, "comprei um fone de 300 em 3x no nubank", { interpreter: ai, now: () => NOW });
    expect(r.usedAi).toBe(true);
    expect(r.reply.text).toContain("3x de R$ 100,00");
    expect((await withUser(u.id, (tx) => periodSummary(tx, u.id, month))).expenseCents).toBe(10000);
  });

  it("valida a saída da IA: categoria inexistente cai em classificação segura", async () => {
    const u = await makeUser();
    const ai: Interpreter = {
      name: "fake",
      interpret: async () => ({
        interpretation: emptyInterpretation("record", {
          confidence: 0.9,
          entries: [{ kind: "expense", amount: 40, description: "Gasolina", merchant: "Posto", counterparty: null, category: "categoria-inventada", date: "1999-01-01", payment_method: null, installments: null, account_hint: null }],
        }),
        usage: null,
      }),
    };
    const r = await send(u.id, "40 de gasolina", { interpreter: ai, now: () => NOW });
    expect(r.reply.text).toContain("Combustível");
    expect(r.reply.text).toContain("24/10/2026"); // data absurda descartada
  });

  it("schema rejeita saída malformada da IA", () => {
    const bad = { intent: "record", entries: [{ kind: "expense", amount: -5 }], confidence: 2 };
    expect(interpretationSchema.safeParse(bad).success).toBe(false);
  });

  it("falha da IA usa a contingência por regras; sem entendimento, avisa sem inventar", async () => {
    const u = await makeUser();
    const broken: Interpreter = { name: "broken", interpret: async () => { throw new AIError("timeout", true); } };
    let errors = 0;
    const deps: AgentDeps = { interpreter: broken, now: () => NOW, onAiError: async () => { errors++; } };
    const ok = await send(u.id, "Gastei 50 reais no posto", deps);
    expect(ok.reply.text).toContain("Despesa registrada");
    const unclear = await send(u.id, "blablabla xyz", deps);
    expect(unclear.reply.text).toContain("instabilidade");
    expect(errors).toBe(2);
  });

  it("baixa confiança da IA pede confirmação antes de gravar", async () => {
    const u = await makeUser();
    const unsure: Interpreter = {
      name: "unsure",
      interpret: async (): Promise<{ interpretation: Interpretation; usage: null }> => ({
        interpretation: emptyInterpretation("record", { confidence: 0.4, entries: [{ kind: "expense", amount: 30, description: "Algo", merchant: null, counterparty: null, category: null, date: null, payment_method: null, installments: null, account_hint: null }] }),
        usage: null,
      }),
    };
    const r = await send(u.id, "30 aquilo", { interpreter: unsure, now: () => NOW });
    expect(r.reply.text).toContain("Confere antes de eu salvar?");
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
    await press(u.id, r.reply.buttons![0].id);
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(1);
  });
});
