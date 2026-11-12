import { and, desc, eq, isNull, sql, gte, lte, inArray } from "drizzle-orm";
import type { Tx } from "../db/client";
import { accounts, categories, transactions, recurringRules, type Transaction } from "../db/schema";
import { addDays, addMonths, endOfMonth, startOfMonth, type ISODate, type Period } from "./dates";

/**
 * Todos os números exibidos ao cliente saem daqui: SQL sobre o banco, em centavos.
 * Regras:
 *  - Resultado do período (competência) = receitas − (despesas − estornos),
 *    considerando apenas lançamentos pagos/realizados.
 *  - Transferências e pagamentos de fatura NÃO entram no resultado.
 *  - Compras no cartão entram como despesa na data da compra/parcela.
 */

const alive = isNull(transactions.deletedAt);

export type Summary = { incomeCents: number; expenseCents: number; refundCents: number; netExpenseCents: number; resultCents: number; count: number };

export async function periodSummary(tx: Tx, userId: string, p: Period): Promise<Summary> {
  const [r] = await tx
    .select({
      income: sql<number>`coalesce(sum(case when ${transactions.kind} = 'income' then ${transactions.amountCents} end), 0)::bigint`,
      expense: sql<number>`coalesce(sum(case when ${transactions.kind} = 'expense' then ${transactions.amountCents} end), 0)::bigint`,
      refund: sql<number>`coalesce(sum(case when ${transactions.kind} = 'refund' then ${transactions.amountCents} end), 0)::bigint`,
      count: sql<number>`count(*) filter (where ${transactions.kind} in ('income','expense'))::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        alive,
        eq(transactions.status, "paid"),
        inArray(transactions.kind, ["income", "expense", "refund"]),
        gte(transactions.occurredOn, p.from),
        lte(transactions.occurredOn, p.to),
      ),
    );
  const income = Number(r.income);
  const expense = Number(r.expense);
  const refund = Number(r.refund);
  return { incomeCents: income, expenseCents: expense, refundCents: refund, netExpenseCents: expense - refund, resultCents: income - (expense - refund), count: r.count };
}

export type CategoryTotal = { categoryId: string | null; name: string; icon: string; slug: string | null; totalCents: number; count: number };

export async function totalsByCategory(tx: Tx, userId: string, p: Period, kind: "income" | "expense"): Promise<CategoryTotal[]> {
  const sign = kind === "expense" ? sql`case when ${transactions.kind} = 'refund' then -${transactions.amountCents} else ${transactions.amountCents} end` : sql`${transactions.amountCents}`;
  const kinds: Transaction["kind"][] = kind === "expense" ? ["expense", "refund"] : ["income"];
  const rows = await tx
    .select({
      categoryId: transactions.categoryId,
      name: sql<string>`coalesce(${categories.name}, 'Sem categoria')`,
      icon: sql<string>`coalesce(${categories.icon}, '•')`,
      slug: categories.slug,
      total: sql<number>`sum(${sign})::bigint`,
      count: sql<number>`count(*) filter (where ${transactions.kind} <> 'refund')::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(eq(transactions.userId, userId), alive, eq(transactions.status, "paid"), inArray(transactions.kind, kinds), gte(transactions.occurredOn, p.from), lte(transactions.occurredOn, p.to)))
    .groupBy(transactions.categoryId, categories.name, categories.icon, categories.slug)
    .orderBy(desc(sql`sum(${sign})`));
  return rows.map((r) => ({ categoryId: r.categoryId, name: r.name, icon: r.icon, slug: r.slug, totalCents: Number(r.total), count: r.count })).filter((r) => r.totalCents !== 0);
}

export const CARDS_KEY = "cartoes";

/**
 * Gastos por categoria com os cartões à parte: compras no cartão (crédito, débito ou numa
 * conta do tipo cartão) que não têm categoria própria — "Outros"/sem categoria — viram a
 * fatia "Cartões". Compras no cartão com categoria (ex.: Mercado) continuam na categoria.
 */
export async function expensesByCategoryWithCards(tx: Tx, userId: string, p: Period): Promise<CategoryTotal[]> {
  const sign = sql`case when ${transactions.kind} = 'refund' then -${transactions.amountCents} else ${transactions.amountCents} end`;
  const isCard = sql<boolean>`(${transactions.paymentMethod} in ('credito','debito') or ${accounts.type} = 'credit_card')
    and (${categories.slug} is null or ${categories.slug} = 'outros')`;
  const rows = await tx
    .select({
      card: sql<boolean>`${isCard}`,
      categoryId: transactions.categoryId,
      name: sql<string>`coalesce(${categories.name}, 'Sem categoria')`,
      icon: sql<string>`coalesce(${categories.icon}, '•')`,
      slug: categories.slug,
      total: sql<number>`sum(${sign})::bigint`,
      count: sql<number>`count(*) filter (where ${transactions.kind} <> 'refund')::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.userId, userId), alive, eq(transactions.status, "paid"), inArray(transactions.kind, ["expense", "refund"]), gte(transactions.occurredOn, p.from), lte(transactions.occurredOn, p.to)))
    .groupBy(sql`1`, transactions.categoryId, categories.name, categories.icon, categories.slug);
  const out = new Map<string, CategoryTotal>();
  for (const r of rows) {
    const key = r.card ? CARDS_KEY : (r.categoryId ?? "none");
    const cur = out.get(key) ?? (r.card
      ? { categoryId: CARDS_KEY, name: "Cartões", icon: "💳", slug: CARDS_KEY, totalCents: 0, count: 0 }
      : { categoryId: r.categoryId, name: r.name, icon: r.icon, slug: r.slug, totalCents: 0, count: 0 });
    cur.totalCents += Number(r.total);
    cur.count += r.count;
    out.set(key, cur);
  }
  return [...out.values()].filter((r) => r.totalCents !== 0).sort((a, b) => b.totalCents - a.totalCents);
}

export async function totalForCategory(tx: Tx, userId: string, p: Period, kind: "income" | "expense", categorySlug: string) {
  const all = await totalsByCategory(tx, userId, p, kind);
  return all.find((c) => c.slug === categorySlug) ?? null;
}

/** Totais por estabelecimento (despesas) ou por cliente/pagador (receitas), com busca parcial. */
export async function totalsByParty(tx: Tx, userId: string, p: Period, kind: "income" | "expense", search?: string | null) {
  const party = kind === "expense" ? transactions.merchant : transactions.counterparty;
  const conds = [
    eq(transactions.userId, userId),
    alive,
    eq(transactions.status, "paid"),
    eq(transactions.kind, kind),
    gte(transactions.occurredOn, p.from),
    lte(transactions.occurredOn, p.to),
  ];
  if (search) {
    const like = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(sql`(${party} ilike ${like} or ${transactions.description} ilike ${like})`);
  }
  const rows = await tx
    .select({
      party: sql<string>`coalesce(nullif(${party}, ''), 'Não informado')`,
      total: sql<number>`sum(${transactions.amountCents})::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...conds))
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`));
  return rows.map((r) => ({ party: r.party, totalCents: Number(r.total), count: r.count }));
}

export async function largestTransaction(tx: Tx, userId: string, p: Period, kind: "income" | "expense") {
  const [row] = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), alive, eq(transactions.status, "paid"), eq(transactions.kind, kind), gte(transactions.occurredOn, p.from), lte(transactions.occurredOn, p.to)))
    .orderBy(desc(transactions.amountCents), desc(transactions.occurredOn))
    .limit(1);
  return row ?? null;
}

export type TxWithCategory = Transaction & { categoryName: string | null; categoryIcon: string | null; accountName: string };

export async function listTransactions(
  tx: Tx,
  userId: string,
  opts: { limit?: number; offset?: number; period?: Period; kind?: Transaction["kind"]; status?: "paid" | "pending"; categoryId?: string; accountId?: string; search?: string; paymentMethod?: string } = {},
): Promise<TxWithCategory[]> {
  const conds = [eq(transactions.userId, userId), alive];
  if (opts.period) conds.push(gte(transactions.occurredOn, opts.period.from), lte(transactions.occurredOn, opts.period.to));
  if (opts.kind) conds.push(eq(transactions.kind, opts.kind));
  if (opts.status) conds.push(eq(transactions.status, opts.status));
  if (opts.categoryId) conds.push(eq(transactions.categoryId, opts.categoryId));
  if (opts.paymentMethod) conds.push(opts.paymentMethod === "nenhuma" ? sql`${transactions.paymentMethod} is null` : eq(transactions.paymentMethod, opts.paymentMethod));
  if (opts.accountId) conds.push(sql`(${transactions.accountId} = ${opts.accountId} or ${transactions.toAccountId} = ${opts.accountId})`);
  if (opts.search) {
    const like = `%${opts.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(sql`(${transactions.description} ilike ${like} or ${transactions.merchant} ilike ${like} or ${transactions.counterparty} ilike ${like})`);
  }
  const rows = await tx
    .select({ t: transactions, categoryName: categories.name, categoryIcon: categories.icon, accountName: accounts.name })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(...conds))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(Math.min(opts.limit ?? 10, 500))
    .offset(opts.offset ?? 0);
  return rows.map((r) => ({ ...r.t, categoryName: r.categoryName, categoryIcon: r.categoryIcon, accountName: r.accountName }));
}

/** Lançamentos mais recentes (por criação), usados para resolver "o último gasto" etc. */
export async function recentEntries(tx: Tx, userId: string, opts: { kind?: "income" | "expense"; limit?: number } = {}) {
  const conds = [eq(transactions.userId, userId), alive];
  if (opts.kind) conds.push(eq(transactions.kind, opts.kind));
  else conds.push(inArray(transactions.kind, ["income", "expense", "refund", "transfer", "card_payment"]));
  return tx
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.createdAt))
    .limit(opts.limit ?? 20);
}

export type AccountBalance = { accountId: string; name: string; type: string; balanceCents: number; futureCents: number; creditLimitCents: number | null };

/**
 * Saldo por conta até `today` (lançamentos pagos). Para cartões o saldo é negativo
 * (dívida). `futureCents` = movimentações já lançadas com data futura (parcelas do
 * cartão e contas a pagar/receber), ou seja, valores comprometidos.
 */
export async function accountBalances(tx: Tx, userId: string, today: ISODate): Promise<AccountBalance[]> {
  const result = await tx.execute<{ id: string; name: string; type: string; credit_limit_cents: number | null; initial: number; balance: string; future: string }>(sql`
    with movements as (
      select t.account_id as account_id,
             case t.kind
               when 'income' then t.amount_cents
               when 'refund' then t.amount_cents
               when 'expense' then -t.amount_cents
               else -t.amount_cents  -- transfer / card_payment saindo
             end as delta,
             t.occurred_on, t.status
        from transactions t
       where t.user_id = ${userId} and t.deleted_at is null
      union all
      select t.to_account_id, t.amount_cents, t.occurred_on, t.status
        from transactions t
       where t.user_id = ${userId} and t.deleted_at is null and t.to_account_id is not null
    )
    select a.id, a.name, a.type::text as type, a.credit_limit_cents, a.initial_balance_cents as initial,
           coalesce(sum(m.delta) filter (where m.status = 'paid' and m.occurred_on <= ${today}), 0)::bigint as balance,
           coalesce(sum(m.delta) filter (where m.status = 'pending' or m.occurred_on > ${today}), 0)::bigint as future
      from accounts a
      left join movements m on m.account_id = a.id
     where a.user_id = ${userId} and a.archived_at is null
     group by a.id
     order by a.is_default desc, a.name
  `);
  return result.rows.map((r) => ({
    accountId: r.id,
    name: r.name,
    type: r.type,
    balanceCents: Number(r.initial) + Number(r.balance),
    futureCents: Number(r.future),
    creditLimitCents: r.credit_limit_cents,
  }));
}

export type Availability = {
  availableCents: number; // soma das contas (exceto cartões)
  cardDebtCents: number; // faturas em aberto até hoje (positivo)
  payablesCents: number; // contas a pagar pendentes
  receivablesCents: number; // contas a receber pendentes
  futureCardInstallmentsCents: number; // parcelas futuras já lançadas no cartão
  projectedCents: number; // disponível − compromissos + recebíveis
  accounts: AccountBalance[];
};

export async function availability(tx: Tx, userId: string, today: ISODate): Promise<Availability> {
  const accs = await accountBalances(tx, userId, today);
  const available = accs.filter((a) => a.type !== "credit_card").reduce((s, a) => s + a.balanceCents, 0);
  const cardDebt = accs.filter((a) => a.type === "credit_card").reduce((s, a) => s + Math.max(0, -a.balanceCents), 0);
  const futureCard = accs.filter((a) => a.type === "credit_card").reduce((s, a) => s + Math.max(0, -a.futureCents), 0);
  const [p] = await tx
    .select({
      payables: sql<number>`coalesce(sum(case when ${transactions.kind} = 'expense' then ${transactions.amountCents} end), 0)::bigint`,
      receivables: sql<number>`coalesce(sum(case when ${transactions.kind} = 'income' then ${transactions.amountCents} end), 0)::bigint`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), alive, eq(transactions.status, "pending")));
  const payables = Number(p.payables);
  const receivables = Number(p.receivables);
  return {
    availableCents: available,
    cardDebtCents: cardDebt,
    payablesCents: payables,
    receivablesCents: receivables,
    futureCardInstallmentsCents: futureCard,
    projectedCents: available - cardDebt - payables - futureCard + receivables,
    accounts: accs,
  };
}

/** Contas a pagar pendentes vencendo até `until` (inclui atrasadas). */
export async function payables(tx: Tx, userId: string, until: ISODate | null) {
  const conds = [eq(transactions.userId, userId), alive, eq(transactions.status, "pending"), eq(transactions.kind, "expense")];
  if (until) conds.push(lte(transactions.dueOn, until));
  return tx.select().from(transactions).where(and(...conds)).orderBy(transactions.dueOn).limit(50);
}

export async function monthlyEvolution(tx: Tx, userId: string, today: ISODate, months: number) {
  const n = Math.max(1, Math.min(24, months));
  const out: { month: ISODate; incomeCents: number; expenseCents: number; resultCents: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = startOfMonth(addMonths(startOfMonth(today), -i));
    const s = await periodSummary(tx, userId, { from: m, to: endOfMonth(m), label: "" });
    out.push({ month: m, incomeCents: s.incomeCents, expenseCents: s.netExpenseCents, resultCents: s.resultCents });
  }
  return out;
}

export async function listRecurring(tx: Tx, userId: string) {
  return tx.select().from(recurringRules).where(and(eq(recurringRules.userId, userId), eq(recurringRules.active, true))).orderBy(recurringRules.dayOfMonth);
}

/** Possíveis duplicidades: mesmo valor, tipo e dia, criadas com até 10 min de diferença. */
export async function findDuplicates(tx: Tx, userId: string, sinceDays: number, today: ISODate) {
  const result = await tx.execute<{ a: string; b: string }>(sql`
    select t1.id as a, t2.id as b
      from transactions t1
      join transactions t2
        on t2.user_id = t1.user_id and t2.id <> t1.id and t2.created_at > t1.created_at
       and t2.amount_cents = t1.amount_cents and t2.kind = t1.kind and t2.occurred_on = t1.occurred_on
       and t2.created_at - t1.created_at < interval '10 minutes'
     where t1.user_id = ${userId} and t1.deleted_at is null and t2.deleted_at is null
       and t1.occurred_on >= ${addDays(today, -sinceDays)}
     order by t2.created_at desc
     limit 10`);
  return result.rows;
}

/** Despesas (menos estornos) por dia no período, para o gráfico de ritmo de gastos. */
export async function dailyExpenses(tx: Tx, userId: string, p: Period): Promise<{ date: ISODate; cents: number }[]> {
  const rows = await tx
    .select({
      date: transactions.occurredOn,
      cents: sql<number>`sum(case when ${transactions.kind} = 'refund' then -${transactions.amountCents} else ${transactions.amountCents} end)::bigint`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), alive, eq(transactions.status, "paid"), inArray(transactions.kind, ["expense", "refund"]), gte(transactions.occurredOn, p.from), lte(transactions.occurredOn, p.to)))
    .groupBy(transactions.occurredOn)
    .orderBy(transactions.occurredOn);
  return rows.map((r) => ({ date: r.date, cents: Number(r.cents) }));
}

/** Total pago por forma de pagamento no período (cartão, Pix, dinheiro...). Sem forma informada = null. */
export async function totalsByPaymentMethod(tx: Tx, userId: string, period: Period, kind: "income" | "expense") {
  return tx
    .select({
      method: transactions.paymentMethod,
      totalCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), alive, eq(transactions.kind, kind), eq(transactions.status, "paid"), gte(transactions.occurredOn, period.from), lte(transactions.occurredOn, period.to)))
    .groupBy(transactions.paymentMethod)
    .orderBy(sql`3 desc`);
}
