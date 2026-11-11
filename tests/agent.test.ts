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

describe("limites de gasto", () => {
  const i = (t: string) => interpretByRules(t, { today: TODAY });

  it("entende pedidos de limite por regras", () => {
    expect(i("limite de 800 para alimentação")).toMatchObject({ intent: "budget", budget: { action: "set", category: "alimentacao", amount: 800 } });
    expect(i("meu limite do mês é 3 mil")).toMatchObject({ intent: "budget", budget: { action: "set", category: null, amount: 3000 } });
    expect(i("como estão meus limites?")).toMatchObject({ intent: "budget", budget: { action: "status" } });
    expect(i("tira o limite de mercado")).toMatchObject({ intent: "budget", budget: { action: "remove", category: "mercado" } });
  });

  it("avisa uma vez em 80% e uma vez em 100%, e não conta outras categorias", async () => {
    const u = await makeUser();
    const r1 = await send(u.id, "limite de 100 para mercado");
    expect(r1.reply.text).toContain("Limite definido");

    const a = await send(u.id, "gastei 50 no mercado");
    expect(a.reply.text).not.toContain("limite");
    const other = await send(u.id, "gastei 300 no posto");
    expect(other.reply.text).not.toContain("limite");

    const b = await send(u.id, "gastei 35 no mercado");
    expect(b.reply.text).toContain("85% do limite de *Mercado*");
    const c = await send(u.id, "gastei 5 no mercado");
    expect(c.reply.text).not.toContain("limite"); // 90%: já avisado em 80%

    const d = await send(u.id, "gastei 20 no mercado");
    expect(d.reply.text).toContain("passou do limite de *Mercado*");
    const e = await send(u.id, "gastei 1 no mercado");
    expect(e.reply.text).not.toContain("limite");

    const status = await send(u.id, "como estão meus limites?");
    expect(status.reply.text).toContain("Mercado: R$ 111,00 de R$ 100,00 (111%)");
  });

  it("limite total do mês soma todas as despesas; remover apaga o limite", async () => {
    const u = await makeUser();
    await send(u.id, "meu limite do mês é 1000");
    await send(u.id, "gastei 500 no mercado");
    const r = await send(u.id, "gastei 300 no posto");
    expect(r.reply.text).toContain("80% do limite *total do mês*");
    const removed = await send(u.id, "tira o limite do mês");
    expect(removed.reply.text).toContain("removido");
    const st = await send(u.id, "meus limites");
    expect(st.reply.text).toContain("ainda não definiu limites");
  });

  it("isolamento: um cliente não vê nem altera o limite do outro", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await send(a.id, "limite de 100 para mercado");
    const st = await send(b.id, "como estão meus limites?");
    expect(st.reply.text).toContain("ainda não definiu limites");
  });
});

describe("contas fixas pelo WhatsApp", () => {
  const i = (t: string) => interpretByRules(t, { today: TODAY });

  it("entende cadastro, lista e remoção por regras", () => {
    expect(i("meu aluguel é 1.200 todo dia 10")).toMatchObject({ intent: "fixed", fixed: { action: "set", kind: "expense", description: "Aluguel", amount: 1200, day: 10, category: "moradia" } });
    expect(i("internet 120 todo mês dia 5")).toMatchObject({ intent: "fixed", fixed: { action: "set", amount: 120, day: 5, category: "internet-telefone" } });
    expect(i("quais são minhas contas fixas?")).toMatchObject({ intent: "fixed", fixed: { action: "list" } });
    expect(i("tira o aluguel das contas fixas")).toMatchObject({ intent: "fixed", fixed: { action: "remove", description: "Aluguel" } });
    expect(i("recebo 3 mil de salário todo dia 5")).toMatchObject({ intent: "fixed", fixed: { action: "set", kind: "income", amount: 3000, day: 5 } });
  });

  it("cadastra, gera a conta a pagar quando vence em até 7 dias e 'paguei o aluguel' dá baixa sem duplicar", async () => {
    const u = await makeUser();
    // hoje é 24/10: vence dia 28 → já vira conta a pagar
    const r = await send(u.id, "meu aluguel é 1.200 todo dia 28");
    expect(r.reply.text).toContain("Conta fixa cadastrada");
    expect(r.reply.text).toContain("28/10/2026");
    let list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "pending", amountCents: 120000, dueOn: "2026-10-28" });

    const paid = await send(u.id, "paguei o aluguel 1200");
    expect(paid.reply.text).toContain("Conta fixa paga");
    list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "paid", amountCents: 120000, occurredOn: TODAY });

    const lst = await send(u.id, "minhas contas fixas");
    expect(lst.reply.text).toContain("Dia 28 · 🏠 Aluguel · R$ 1.200,00");

    const rm = await send(u.id, "tira o aluguel das contas fixas");
    expect(rm.reply.text).toContain("encerrada");
    expect((await send(u.id, "minhas contas fixas")).reply.text).toContain("ainda não tem contas fixas");
  });

  it("vencimento longe: não gera ainda; pedir sem valor pergunta o que falta", async () => {
    const u = await makeUser();
    const r = await send(u.id, "internet 120 todo mês dia 5");
    expect(r.reply.text).toContain("05/11/2026");
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
    const q = await send(u.id, "cadastra a luz como conta fixa");
    expect(q.reply.text).toContain("o valor e o dia do vencimento");
  });

  it("rotina diária roda uma vez só e gera as contas a pagar", async () => {
    const { runDailyIfDue } = await import("@/server/ops/maintenance");
    const u = await makeUser();
    await send(u.id, "internet 120 todo mês dia 5");
    // 1º/11 em São Paulo: dia 5 está a menos de 7 dias
    expect(await runDailyIfDue(new Date("2026-11-01T12:00:00Z"))).toBe(true);
    expect(await runDailyIfDue(new Date("2026-11-01T13:00:00Z"))).toBe(false);
    const list = await withUser(u.id, (tx) => listTransactions(tx, u.id));
    expect(list[0]).toMatchObject({ status: "pending", dueOn: "2026-11-05", amountCents: 12000 });
  });
});
