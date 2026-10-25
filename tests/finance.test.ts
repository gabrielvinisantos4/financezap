import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, db, withUser } from "@/server/db/client";
import { transactions, transactionHistory } from "@/server/db/schema";
import {
  createAccount,
  createEntry,
  createRefund,
  createTransfer,
  deleteEntry,
  updateEntry,
  defaultAccount,
  createRecurringRule,
  generateRecurring,
  getCategoryBySlug,
} from "@/server/finance/engine";
import { availability, payables, periodSummary, totalsByCategory, totalsByParty, largestTransaction, monthlyEvolution } from "@/server/finance/queries";
import { parseBRL, formatBRL, splitInstallments } from "@/server/finance/money";
import { addMonths, resolvePeriod } from "@/server/finance/dates";
import { guessCategorySlug } from "@/server/finance/categories";
import { FinanceError } from "@/server/finance/errors";
import { makeUser, resetDb, TODAY } from "./helpers";
import { withSystem } from "@/server/db/client";

const month = resolvePeriod({ type: "this_month" }, TODAY);

beforeEach(resetDb);
afterAll(closeDb);

describe("dinheiro e datas", () => {
  it("interpreta valores em pt-BR sem erro de ponto flutuante", () => {
    expect(parseBRL("50")).toBe(5000);
    expect(parseBRL("50,90")).toBe(5090);
    expect(parseBRL("R$ 1.200,50")).toBe(120050);
    expect(parseBRL("1.200")).toBe(120000);
    expect(parseBRL("mil")).toBe(100000);
    expect(parseBRL("2 mil")).toBe(200000);
    expect(parseBRL("1,5 mil")).toBe(150000);
    expect(parseBRL("0,1")).toBe(10);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("0")).toBeNull();
    expect(formatBRL(5000)).toBe("R$ 50,00");
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
  });

  it("divide parcelas preservando o total", () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(10000, 3).reduce((a, b) => a + b)).toBe(10000);
  });

  it("soma meses respeitando o último dia do mês", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("resolve períodos relativos no calendário do usuário", () => {
    expect(resolvePeriod({ type: "this_month" }, TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod({ type: "month", month: 12 }, TODAY)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod({ type: "this_week" }, TODAY)).toMatchObject({ from: "2026-10-19", to: TODAY });
  });

  it("classifica categorias por palavras-chave", () => {
    expect(guessCategorySlug("gastei 50 no posto", "expense")).toBe("combustivel");
    expect(guessCategorySlug("comprei 85 no mercado", "expense")).toBe("mercado");
    expect(guessCategorySlug("paguei 120 de energia", "expense")).toBe("agua-energia");
    expect(guessCategorySlug("recebi 600 por um vídeo", "income")).toBe("video");
    expect(guessCategorySlug("algo aleatório", "expense")).toBe("outros");
  });
});

describe("motor financeiro", () => {
  it("registra receitas e despesas e calcula o resultado do mês no banco", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      await createEntry(tx, u.id, { kind: "expense", amountCents: 5000, description: "Posto", categorySlug: "combustivel", merchant: "Posto Shell", occurredOn: TODAY, source: "web" }, "user", TODAY);
      await createEntry(tx, u.id, { kind: "income", amountCents: 100000, description: "Cliente de marketing", categorySlug: "marketing", counterparty: "Padaria Valério", occurredOn: TODAY, source: "web" }, "user", TODAY);
      await createEntry(tx, u.id, { kind: "expense", amountCents: 8500, description: "Mercado", categorySlug: "mercado", occurredOn: "2026-10-02", source: "web" }, "user", TODAY);
      const s = await periodSummary(tx, u.id, month);
      expect(s).toMatchObject({ incomeCents: 100000, expenseCents: 13500, resultCents: 86500 });
      const cats = await totalsByCategory(tx, u.id, month, "expense");
      expect(cats.map((c) => [c.slug, c.totalCents])).toEqual([["mercado", 8500], ["combustivel", 5000]]);
      const biggest = await largestTransaction(tx, u.id, month, "expense");
      expect(biggest?.amountCents).toBe(8500);
      const clients = await totalsByParty(tx, u.id, month, "income");
      expect(clients[0]).toMatchObject({ party: "Padaria Valério", totalCents: 100000 });
    });
  });

  it("não conta transferência entre contas próprias como receita nem despesa", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      const main = await defaultAccount(tx, u.id);
      const savings = await createAccount(tx, u.id, { name: "Poupança", type: "savings" }, 10);
      await createEntry(tx, u.id, { kind: "income", amountCents: 200000, description: "Salário", occurredOn: TODAY, source: "web" }, "user", TODAY);
      await createTransfer(tx, u.id, { fromAccountId: main.id, toAccountId: savings.id, amountCents: 50000, occurredOn: TODAY, source: "web" }, "user");
      const s = await periodSummary(tx, u.id, month);
      expect(s.incomeCents).toBe(200000);
      expect(s.expenseCents).toBe(0);
      const a = await availability(tx, u.id, TODAY);
      expect(a.accounts.find((x) => x.accountId === main.id)?.balanceCents).toBe(150000);
      expect(a.accounts.find((x) => x.accountId === savings.id)?.balanceCents).toBe(50000);
      expect(a.availableCents).toBe(200000);
    });
  });

  it("compra no cartão é despesa uma única vez; pagar a fatura não duplica", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      const main = await defaultAccount(tx, u.id);
      const card = await createAccount(tx, u.id, { name: "Nubank", type: "credit_card", closingDay: 3, dueDay: 10, creditLimitCents: 500000 }, 10);
      await createEntry(tx, u.id, { kind: "income", amountCents: 300000, description: "Salário", occurredOn: "2026-10-01", source: "web" }, "user", TODAY);
      await createEntry(tx, u.id, { kind: "expense", amountCents: 20000, description: "Jantar", accountId: card.id, occurredOn: "2026-10-05", source: "web" }, "user", TODAY);
      let a = await availability(tx, u.id, TODAY);
      expect(a.cardDebtCents).toBe(20000);
      expect(a.availableCents).toBe(300000);
      await createTransfer(tx, u.id, { fromAccountId: main.id, toAccountId: card.id, amountCents: 20000, occurredOn: TODAY, source: "web" }, "user");
      const s = await periodSummary(tx, u.id, month);
      expect(s.expenseCents).toBe(20000); // só a compra
      a = await availability(tx, u.id, TODAY);
      expect(a.cardDebtCents).toBe(0);
      expect(a.availableCents).toBe(280000);
      const [{ kind }] = await tx.select({ kind: transactions.kind }).from(transactions).where(sql`${transactions.toAccountId} = ${card.id}`);
      expect(kind).toBe("card_payment");
    });
  });

  it("parcelamento no cartão distribui a despesa pelos meses e mantém o total", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      const card = await createAccount(tx, u.id, { name: "Cartão", type: "credit_card", closingDay: 1, dueDay: 8 }, 10);
      const rows = await createEntry(tx, u.id, { kind: "expense", amountCents: 100000, description: "Lente", accountId: card.id, installments: 3, occurredOn: TODAY, source: "web" }, "user", TODAY);
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.occurredOn)).toEqual(["2026-10-24", "2026-11-24", "2026-12-24"]);
      expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(100000);
      expect((await periodSummary(tx, u.id, month)).expenseCents).toBe(33334);
      const a = await availability(tx, u.id, TODAY);
      expect(a.cardDebtCents).toBe(33334);
      expect(a.futureCardInstallmentsCents).toBe(66666);
    });
  });

  it("parcelas fora do cartão viram contas a pagar", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      await createEntry(tx, u.id, { kind: "expense", amountCents: 60000, description: "Curso", installments: 3, occurredOn: TODAY, source: "web" }, "user", TODAY);
      const list = await payables(tx, u.id, null);
      expect(list.map((p) => p.dueOn)).toEqual(["2026-11-24", "2026-12-24"]);
      const a = await availability(tx, u.id, TODAY);
      expect(a.payablesCents).toBe(40000);
    });
  });

  it("estorno reduz a despesa e não pode exceder o original", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      const [exp] = await createEntry(tx, u.id, { kind: "expense", amountCents: 10000, description: "Tênis", categorySlug: "compras-pessoais", occurredOn: TODAY, source: "web" }, "user", TODAY);
      await createRefund(tx, u.id, { originalId: exp.id, amountCents: 4000, occurredOn: TODAY, source: "web" }, "user");
      const s = await periodSummary(tx, u.id, month);
      expect(s.netExpenseCents).toBe(6000);
      const cats = await totalsByCategory(tx, u.id, month, "expense");
      expect(cats[0]).toMatchObject({ slug: "compras-pessoais", totalCents: 6000 });
      await expect(createRefund(tx, u.id, { originalId: exp.id, amountCents: 7000, occurredOn: TODAY, source: "web" }, "user")).rejects.toBeInstanceOf(FinanceError);
    });
  });

  it("corrige e exclui lançamentos com histórico e controle de versão", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      const [t] = await createEntry(tx, u.id, { kind: "expense", amountCents: 5000, description: "Posto", categorySlug: "combustivel", occurredOn: TODAY, source: "web" }, "user", TODAY);
      const upd = await updateEntry(tx, u.id, t.id, { amountCents: 7000, categorySlug: "mercado" }, "agent", { expectedVersion: 1 });
      expect(upd.amountCents).toBe(7000);
      expect(upd.version).toBe(2);
      const mercado = await getCategoryBySlug(tx, u.id, "expense", "mercado");
      expect(upd.categoryId).toBe(mercado?.id);
      // versão antiga não pode sobrescrever
      await expect(updateEntry(tx, u.id, t.id, { amountCents: 1 }, "agent", { expectedVersion: 1 })).rejects.toMatchObject({ code: "conflict" });
      expect((await periodSummary(tx, u.id, month)).expenseCents).toBe(7000);
      await deleteEntry(tx, u.id, t.id, "agent");
      expect((await periodSummary(tx, u.id, month)).expenseCents).toBe(0);
      // excluir de novo falha (não executa a mesma operação duas vezes)
      await expect(deleteEntry(tx, u.id, t.id, "agent")).rejects.toMatchObject({ code: "not_found" });
      const hist = await tx.select().from(transactionHistory).where(sql`${transactionHistory.transactionId} = ${t.id}`);
      expect(hist.map((h) => h.action).sort()).toEqual(["create", "delete", "update"]);
    });
  });

  it("gera contas recorrentes uma única vez por vencimento", async () => {
    const u = await makeUser();
    await withUser(u.id, (tx) => createRecurringRule(tx, u.id, { kind: "expense", amountCents: 9990, description: "Internet", dayOfMonth: 10, startOn: "2026-10-01" }));
    const first = await withSystem((tx) => generateRecurring(tx, "2026-11-15"));
    const second = await withSystem((tx) => generateRecurring(tx, "2026-11-15"));
    expect(first).toBe(2); // 10/10 e 10/11
    expect(second).toBe(0);
    const list = await withUser(u.id, (tx) => payables(tx, u.id, null));
    expect(list.map((p) => p.dueOn)).toEqual(["2026-10-10", "2026-11-10"]);
  });

  it("evolução mensal reflete os meses corretos", async () => {
    const u = await makeUser();
    await withUser(u.id, async (tx) => {
      await createEntry(tx, u.id, { kind: "income", amountCents: 1000, description: "x", occurredOn: "2026-09-10", source: "web" }, "user", TODAY);
      await createEntry(tx, u.id, { kind: "expense", amountCents: 300, description: "y", occurredOn: "2026-10-10", source: "web" }, "user", TODAY);
      const evo = await monthlyEvolution(tx, u.id, TODAY, 3);
      expect(evo.map((e) => [e.month, e.resultCents])).toEqual([["2026-08-01", 0], ["2026-09-01", 1000], ["2026-10-01", -300]]);
    });
  });
});

describe("isolamento entre clientes", () => {
  it("um cliente não lê, altera nem exclui dados de outro (aplicação + RLS)", async () => {
    const a = await makeUser({ name: "Ana" });
    const b = await makeUser({ name: "Bruno" });
    const [ta] = await withUser(a.id, (tx) => createEntry(tx, a.id, { kind: "expense", amountCents: 5000, description: "Ana gasto", occurredOn: TODAY, source: "web" }, "user", TODAY));

    // Pela camada de aplicação
    await expect(withUser(b.id, (tx) => updateEntry(tx, b.id, ta.id, { amountCents: 1 }, "user"))).rejects.toMatchObject({ code: "not_found" });
    await expect(withUser(b.id, (tx) => deleteEntry(tx, b.id, ta.id, "user"))).rejects.toMatchObject({ code: "not_found" });

    // Mesmo com SQL "esquecendo" o filtro por usuário, o banco não devolve nada de outro cliente
    const leaked = await withUser(b.id, (tx) => tx.select().from(transactions));
    expect(leaked).toHaveLength(0);
    // Mesmo passando o userId de A, o contexto de B bloqueia
    const leaked2 = await withUser(b.id, (tx) => periodSummary(tx, a.id, month));
    expect(leaked2.expenseCents).toBe(0);
    // Escrita com user_id de outro cliente é rejeitada pelo banco
    await expect(
      withUser(b.id, (tx) => tx.execute(sql`update transactions set amount_cents = 1 where id = ${ta.id}`)),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      withUser(b.id, async (tx) => {
        const acc = await defaultAccount(tx, b.id);
        await tx.insert(transactions).values({ userId: a.id, kind: "expense", amountCents: 1, description: "x", accountId: acc.id, occurredOn: TODAY });
      }),
    ).rejects.toThrow();
    // Lançamento de B não pode apontar para conta de A (FK composta)
    const accA = await withUser(a.id, (tx) => defaultAccount(tx, a.id));
    await expect(
      withUser(b.id, (tx) => createEntry(tx, b.id, { kind: "expense", amountCents: 100, description: "x", accountId: accA.id, occurredOn: TODAY, source: "web" }, "user", TODAY)),
    ).rejects.toMatchObject({ code: "not_found" });
    // Sem contexto nenhum, nada é visível
    expect(await db().select().from(transactions)).toHaveLength(0);
    // Dados de A continuam intactos
    const s = await withUser(a.id, (tx) => periodSummary(tx, a.id, month));
    expect(s.expenseCents).toBe(5000);
  });
});

describe("persistência", () => {
  it("os dados permanecem após fechar e reabrir as conexões", async () => {
    const u = await makeUser();
    await withUser(u.id, (tx) => createEntry(tx, u.id, { kind: "income", amountCents: 60000, description: "Vídeo", occurredOn: TODAY, source: "web" }, "user", TODAY));
    await closeDb();
    const s = await withUser(u.id, (tx) => periodSummary(tx, u.id, month));
    expect(s.incomeCents).toBe(60000);
  });
});
