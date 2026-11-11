import { and, eq, isNull, sql, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Tx } from "../db/client";
import {
  accounts,
  categories,
  transactions,
  transactionHistory,
  recurringRules,
  type Account,
  type Category,
  type Transaction,
} from "../db/schema";
import { assertValidAmount, splitInstallments } from "./money";
import { addMonths, isISODate, type ISODate } from "./dates";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, slugify } from "./categories";
import { FinanceError } from "./errors";

export type Actor = "user" | "agent" | "system" | "admin";
export type Source = "whatsapp" | "web" | "system";

/* ------------------------------------------------------------------ */
/* Bootstrap de um novo cliente                                         */
/* ------------------------------------------------------------------ */
export async function bootstrapUserData(tx: Tx, userId: string) {
  const existing = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, userId)).limit(1);
  if (existing.length) return;
  await tx.insert(accounts).values([
    { userId, name: "Conta principal", type: "checking", isDefault: true },
    { userId, name: "Dinheiro", type: "cash" },
  ]);
  await tx.insert(categories).values([
    ...DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ userId, kind: "expense" as const, name: c.name, slug: c.slug, icon: c.icon, isSystem: true })),
    ...DEFAULT_INCOME_CATEGORIES.map((c) => ({ userId, kind: "income" as const, name: c.name, slug: c.slug, icon: c.icon, isSystem: true })),
  ]);
}

/* ------------------------------------------------------------------ */
/* Leitura auxiliar (sempre filtrada por usuário + RLS)                 */
/* ------------------------------------------------------------------ */
export async function getAccount(tx: Tx, userId: string, accountId: string): Promise<Account> {
  const [row] = await tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId), isNull(accounts.archivedAt)));
  if (!row) throw new FinanceError("not_found", "Conta não encontrada.");
  return row;
}

export async function listAccounts(tx: Tx, userId: string): Promise<Account[]> {
  return tx
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)))
    .orderBy(sql`${accounts.isDefault} desc`, accounts.name);
}

export async function defaultAccount(tx: Tx, userId: string): Promise<Account> {
  const list = await listAccounts(tx, userId);
  const acc = list.find((a) => a.isDefault) ?? list.find((a) => a.type !== "credit_card");
  if (!acc) throw new FinanceError("invalid", "Cadastre uma conta antes de lançar movimentações.");
  return acc;
}

export async function getCategoryBySlug(tx: Tx, userId: string, kind: "income" | "expense", slug: string): Promise<Category | null> {
  const [row] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.kind, kind), eq(categories.slug, slug), isNull(categories.archivedAt)));
  return row ?? null;
}

export async function listCategories(tx: Tx, userId: string, kind?: "income" | "expense"): Promise<Category[]> {
  const conds = [eq(categories.userId, userId), isNull(categories.archivedAt)];
  if (kind) conds.push(eq(categories.kind, kind));
  return tx.select().from(categories).where(and(...conds)).orderBy(categories.kind, categories.name);
}

async function getCategory(tx: Tx, userId: string, categoryId: string): Promise<Category> {
  const [row] = await tx.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
  if (!row) throw new FinanceError("not_found", "Categoria não encontrada.");
  return row;
}

export async function getTransaction(tx: Tx, userId: string, id: string, opts: { includeDeleted?: boolean } = {}): Promise<Transaction> {
  const conds = [eq(transactions.id, id), eq(transactions.userId, userId)];
  if (!opts.includeDeleted) conds.push(isNull(transactions.deletedAt));
  const [row] = await tx.select().from(transactions).where(and(...conds));
  if (!row) throw new FinanceError("not_found", "Lançamento não encontrado.");
  return row;
}

async function writeHistory(
  tx: Tx,
  userId: string,
  transactionId: string,
  action: "create" | "update" | "delete" | "restore",
  actor: Actor,
  before: Transaction | null,
  after: Transaction | null,
  reason?: string,
) {
  await tx.insert(transactionHistory).values({ userId, transactionId, action, actor, before, after, reason });
}

/* ------------------------------------------------------------------ */
/* Receitas e despesas (incluindo cartão e parcelamento)                */
/* ------------------------------------------------------------------ */
export type CreateEntryInput = {
  kind: "income" | "expense";
  amountCents: number;
  description: string;
  merchant?: string | null;
  counterparty?: string | null;
  categoryId?: string | null;
  categorySlug?: string | null;
  accountId?: string | null;
  occurredOn: ISODate;
  status?: "paid" | "pending";
  dueOn?: ISODate | null;
  paymentMethod?: string | null;
  installments?: number | null; // total de parcelas (>= 2)
  notes?: string | null;
  source: Source;
  sourceMessageId?: string | null;
};

export async function createEntry(
  tx: Tx,
  userId: string,
  input: CreateEntryInput,
  actor: Actor,
  today: ISODate,
): Promise<Transaction[]> {
  assertValidAmount(input.amountCents);
  if (!isISODate(input.occurredOn)) throw new FinanceError("invalid", "Data inválida.");
  if (input.dueOn && !isISODate(input.dueOn)) throw new FinanceError("invalid", "Data de vencimento inválida.");
  const description = (input.description ?? "").trim().slice(0, 200);
  if (!description) throw new FinanceError("invalid", "Informe uma descrição.");

  // Conta: explícita > cartão (se pagamento no crédito e houver só um cartão) > padrão
  let account: Account;
  if (input.accountId) {
    account = await getAccount(tx, userId, input.accountId);
  } else if (input.paymentMethod === "credito") {
    const cards = (await listAccounts(tx, userId)).filter((a) => a.type === "credit_card");
    account = cards.length === 1 ? cards[0] : await defaultAccount(tx, userId);
  } else {
    account = await defaultAccount(tx, userId);
  }
  const isCard = account.type === "credit_card";
  if (isCard && input.kind === "income") {
    throw new FinanceError("invalid", "Receitas não podem ser lançadas em cartão de crédito.");
  }

  // Categoria: precisa ser do mesmo tipo (receita/despesa)
  let category: Category | null = null;
  if (input.categoryId) category = await getCategory(tx, userId, input.categoryId);
  else if (input.categorySlug) category = await getCategoryBySlug(tx, userId, input.kind, input.categorySlug);
  if (!category) {
    category = await getCategoryBySlug(tx, userId, input.kind, input.kind === "expense" ? "outros" : "outras-receitas");
  }
  if (category && category.kind !== input.kind) {
    throw new FinanceError("invalid", "A categoria não corresponde ao tipo do lançamento.");
  }

  const n = input.installments && input.installments > 1 ? input.installments : 1;
  const amounts = splitInstallments(input.amountCents, n);
  const groupId = n > 1 ? randomUUID() : null;

  // Compras no cartão são despesa na data da compra (competência) e ficam "pagas" do
  // ponto de vista do lançamento; o pagamento da fatura é um `card_payment`, que não
  // conta como despesa — assim nada é duplicado.
  let baseStatus: "paid" | "pending" = input.status ?? (input.occurredOn > today ? "pending" : "paid");
  if (isCard) baseStatus = "paid";

  const rows = amounts.map((amountCents, i) => {
    const occurredOn = i === 0 ? input.occurredOn : addMonths(input.occurredOn, i);
    let status: "paid" | "pending" = baseStatus;
    let dueOn: ISODate | null = input.dueOn ?? null;
    if (n > 1 && !isCard) {
      // Parcelas futuras fora do cartão viram contas a pagar/receber
      dueOn = i === 0 ? (input.dueOn ?? occurredOn) : addMonths(input.dueOn ?? input.occurredOn, i);
      status = i === 0 ? baseStatus : "pending";
    }
    if (status === "pending" && !dueOn) dueOn = occurredOn;
    return {
      userId,
      kind: input.kind,
      amountCents,
      description: n > 1 ? `${description} (${i + 1}/${n})` : description,
      merchant: input.merchant?.trim().slice(0, 120) || null,
      counterparty: input.counterparty?.trim().slice(0, 120) || null,
      categoryId: category?.id ?? null,
      accountId: account.id,
      occurredOn,
      dueOn,
      status,
      paymentMethod: input.paymentMethod ?? (isCard ? "credito" : null),
      installmentGroupId: groupId,
      installmentNumber: n > 1 ? i + 1 : null,
      installmentTotal: n > 1 ? n : null,
      notes: input.notes?.slice(0, 500) ?? null,
      source: input.source,
      sourceMessageId: input.sourceMessageId ?? null,
    };
  });

  const created = await tx.insert(transactions).values(rows).returning();
  for (const t of created) await writeHistory(tx, userId, t.id, "create", actor, null, t);
  return created;
}

/* ------------------------------------------------------------------ */
/* Transferências e pagamento de fatura                                 */
/* ------------------------------------------------------------------ */
export async function createTransfer(
  tx: Tx,
  userId: string,
  input: { fromAccountId: string; toAccountId: string; amountCents: number; occurredOn: ISODate; description?: string; source: Source; sourceMessageId?: string | null },
  actor: Actor,
): Promise<Transaction> {
  assertValidAmount(input.amountCents);
  if (!isISODate(input.occurredOn)) throw new FinanceError("invalid", "Data inválida.");
  if (input.fromAccountId === input.toAccountId) throw new FinanceError("invalid", "Escolha contas diferentes.");
  const from = await getAccount(tx, userId, input.fromAccountId);
  const to = await getAccount(tx, userId, input.toAccountId);
  if (from.type === "credit_card") throw new FinanceError("invalid", "Não é possível transferir a partir de um cartão de crédito.");
  const kind = to.type === "credit_card" ? "card_payment" : "transfer";
  const [row] = await tx
    .insert(transactions)
    .values({
      userId,
      kind,
      amountCents: input.amountCents,
      description: input.description?.trim() || (kind === "card_payment" ? `Pagamento da fatura ${to.name}` : `Transferência para ${to.name}`),
      accountId: from.id,
      toAccountId: to.id,
      occurredOn: input.occurredOn,
      status: "paid",
      paymentMethod: "transferencia",
      source: input.source,
      sourceMessageId: input.sourceMessageId ?? null,
    })
    .returning();
  await writeHistory(tx, userId, row.id, "create", actor, null, row);
  return row;
}

/* ------------------------------------------------------------------ */
/* Estornos                                                             */
/* ------------------------------------------------------------------ */
export async function createRefund(
  tx: Tx,
  userId: string,
  input: { originalId: string; amountCents?: number | null; occurredOn: ISODate; source: Source; sourceMessageId?: string | null },
  actor: Actor,
): Promise<Transaction> {
  const original = await getTransaction(tx, userId, input.originalId);
  if (original.kind !== "expense") throw new FinanceError("invalid", "Só é possível estornar despesas.");
  const [{ refunded }] = await tx
    .select({ refunded: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.refundOfId, original.id), isNull(transactions.deletedAt)));
  const available = original.amountCents - refunded;
  const amount = input.amountCents ?? available;
  assertValidAmount(amount);
  if (amount > available) throw new FinanceError("invalid", "O estorno é maior que o valor ainda não estornado.");
  const [row] = await tx
    .insert(transactions)
    .values({
      userId,
      kind: "refund",
      amountCents: amount,
      description: `Estorno: ${original.description}`.slice(0, 200),
      merchant: original.merchant,
      categoryId: original.categoryId,
      accountId: original.accountId,
      occurredOn: input.occurredOn,
      status: "paid",
      refundOfId: original.id,
      source: input.source,
      sourceMessageId: input.sourceMessageId ?? null,
    })
    .returning();
  await writeHistory(tx, userId, row.id, "create", actor, null, row);
  return row;
}

/* ------------------------------------------------------------------ */
/* Correção                                                             */
/* ------------------------------------------------------------------ */
export type EntryPatch = Partial<{
  kind: "income" | "expense";
  amountCents: number;
  description: string;
  merchant: string | null;
  counterparty: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  accountId: string;
  occurredOn: ISODate;
  dueOn: ISODate | null;
  status: "paid" | "pending";
  paymentMethod: string | null;
  notes: string | null;
}>;

export async function updateEntry(
  tx: Tx,
  userId: string,
  id: string,
  patch: EntryPatch,
  actor: Actor,
  opts: { expectedVersion?: number; reason?: string } = {},
): Promise<Transaction> {
  const before = await getTransaction(tx, userId, id);
  if (opts.expectedVersion !== undefined && before.version !== opts.expectedVersion) {
    throw new FinanceError("conflict", "Esse lançamento foi alterado em outro lugar. Confira e tente de novo.");
  }
  const kind = patch.kind ?? before.kind;
  if ((patch.kind && !["income", "expense"].includes(before.kind)) || !["income", "expense", "refund", "transfer", "card_payment"].includes(kind)) {
    throw new FinanceError("invalid", "Esse tipo de lançamento não pode ser convertido.");
  }

  const values: Partial<Transaction> = {};
  if (patch.amountCents !== undefined) {
    assertValidAmount(patch.amountCents);
    values.amountCents = patch.amountCents;
  }
  if (patch.description !== undefined) {
    const d = patch.description.trim().slice(0, 200);
    if (!d) throw new FinanceError("invalid", "A descrição não pode ficar vazia.");
    values.description = d;
  }
  if (patch.merchant !== undefined) values.merchant = patch.merchant?.trim().slice(0, 120) || null;
  if (patch.counterparty !== undefined) values.counterparty = patch.counterparty?.trim().slice(0, 120) || null;
  if (patch.notes !== undefined) values.notes = patch.notes?.slice(0, 500) ?? null;
  if (patch.paymentMethod !== undefined) values.paymentMethod = patch.paymentMethod;
  if (patch.occurredOn !== undefined) {
    if (!isISODate(patch.occurredOn)) throw new FinanceError("invalid", "Data inválida.");
    values.occurredOn = patch.occurredOn;
  }
  if (patch.dueOn !== undefined) {
    if (patch.dueOn && !isISODate(patch.dueOn)) throw new FinanceError("invalid", "Data de vencimento inválida.");
    values.dueOn = patch.dueOn;
  }
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.kind !== undefined) values.kind = patch.kind;

  if (patch.accountId !== undefined) {
    const acc = await getAccount(tx, userId, patch.accountId);
    if (acc.type === "credit_card" && kind === "income") throw new FinanceError("invalid", "Receitas não podem ir para cartão de crédito.");
    if (before.toAccountId && acc.id === before.toAccountId) throw new FinanceError("invalid", "Origem e destino precisam ser diferentes.");
    values.accountId = acc.id;
    if (acc.type === "credit_card") values.status = "paid";
  }

  // Categoria: resolve slug; se o tipo mudou e a categoria antiga não serve, cai em "outros"
  if (kind === "income" || kind === "expense") {
    let categoryId = before.categoryId;
    if (patch.categoryId !== undefined) categoryId = patch.categoryId;
    if (patch.categorySlug) {
      const c = await getCategoryBySlug(tx, userId, kind, patch.categorySlug);
      if (!c) throw new FinanceError("invalid", "Categoria não encontrada.");
      categoryId = c.id;
    }
    if (categoryId) {
      const c = await getCategory(tx, userId, categoryId);
      if (c.kind !== kind) {
        const fallback = await getCategoryBySlug(tx, userId, kind, kind === "expense" ? "outros" : "outras-receitas");
        categoryId = fallback?.id ?? null;
      }
    }
    if (categoryId !== before.categoryId) values.categoryId = categoryId;
  }

  // Estorno não pode passar do valor original
  if (before.kind === "refund" && values.amountCents !== undefined && before.refundOfId) {
    const original = await getTransaction(tx, userId, before.refundOfId);
    const [{ others }] = await tx
      .select({ others: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int` })
      .from(transactions)
      .where(and(eq(transactions.refundOfId, original.id), ne(transactions.id, before.id), isNull(transactions.deletedAt)));
    if (values.amountCents + others > original.amountCents) throw new FinanceError("invalid", "O estorno ficaria maior que a despesa original.");
  }

  const finalStatus = values.status ?? before.status;
  if (finalStatus === "pending" && !(values.dueOn ?? before.dueOn)) values.dueOn = values.occurredOn ?? before.occurredOn;

  if (Object.keys(values).length === 0) return before;

  const [after] = await tx
    .update(transactions)
    .set({ ...values, version: sql`${transactions.version} + 1` })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId), eq(transactions.version, before.version), isNull(transactions.deletedAt)))
    .returning();
  if (!after) throw new FinanceError("conflict", "Esse lançamento foi alterado em outro lugar. Confira e tente de novo.");
  await writeHistory(tx, userId, id, "update", actor, before, after, opts.reason);
  return after;
}

export async function markPaid(tx: Tx, userId: string, id: string, paidOn: ISODate, actor: Actor) {
  const t = await getTransaction(tx, userId, id);
  if (t.status === "paid") return t;
  return updateEntry(tx, userId, id, { status: "paid", occurredOn: paidOn }, actor, { reason: "marcado como pago" });
}

/* ------------------------------------------------------------------ */
/* Exclusão (lógica, com histórico)                                     */
/* ------------------------------------------------------------------ */
export async function deleteEntry(
  tx: Tx,
  userId: string,
  id: string,
  actor: Actor,
  opts: { wholeInstallmentGroup?: boolean; expectedVersion?: number; reason?: string } = {},
): Promise<Transaction[]> {
  const target = await getTransaction(tx, userId, id);
  if (opts.expectedVersion !== undefined && target.version !== opts.expectedVersion) {
    throw new FinanceError("conflict", "Esse lançamento foi alterado em outro lugar. Confira e tente de novo.");
  }
  let ids = [target.id];
  if (opts.wholeInstallmentGroup && target.installmentGroupId) {
    const group = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.installmentGroupId, target.installmentGroupId), isNull(transactions.deletedAt)));
    ids = group.map((g) => g.id);
  }
  // Estornos de uma despesa apagada também saem
  const refunds = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), inArray(transactions.refundOfId, ids), isNull(transactions.deletedAt)));
  ids = [...ids, ...refunds.map((r) => r.id)];

  const befores = await tx.select().from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
  const deleted = await tx
    .update(transactions)
    .set({ deletedAt: new Date(), version: sql`${transactions.version} + 1` })
    .where(and(eq(transactions.userId, userId), inArray(transactions.id, ids), isNull(transactions.deletedAt)))
    .returning();
  for (const d of deleted) {
    await writeHistory(tx, userId, d.id, "delete", actor, befores.find((b) => b.id === d.id) ?? null, d, opts.reason);
  }
  return deleted;
}

/**
 * Apaga todos os lançamentos da pessoa de uma vez (exclusão lógica, com histórico).
 * Contas, categorias, limites e contas fixas continuam cadastrados.
 */
export async function deleteAllEntries(tx: Tx, userId: string, actor: Actor, kind: "expense" | "income" | null = null): Promise<number> {
  const scope = and(eq(transactions.userId, userId), isNull(transactions.deletedAt), kind ? eq(transactions.kind, kind) : undefined);
  const befores = await tx.select().from(transactions).where(scope);
  if (!befores.length) return 0;
  const deleted = await tx
    .update(transactions)
    .set({ deletedAt: new Date(), version: sql`${transactions.version} + 1` })
    .where(scope)
    .returning();
  const byId = new Map(befores.map((b) => [b.id, b]));
  for (let i = 0; i < deleted.length; i += 500) {
    await tx.insert(transactionHistory).values(
      deleted.slice(i, i + 500).map((d) => ({ userId, transactionId: d.id, action: "delete" as const, actor, before: byId.get(d.id) ?? null, after: d, reason: kind === "expense" ? "apagar todos os gastos" : kind === "income" ? "apagar todos os recebimentos" : "apagar todos os lançamentos" })),
    );
  }
  return deleted.length;
}

export async function restoreEntry(tx: Tx, userId: string, id: string, actor: Actor) {
  const before = await getTransaction(tx, userId, id, { includeDeleted: true });
  if (!before.deletedAt) return before;
  const [after] = await tx
    .update(transactions)
    .set({ deletedAt: null, version: sql`${transactions.version} + 1` })
    .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
    .returning();
  await writeHistory(tx, userId, id, "restore", actor, before, after);
  return after;
}

/* ------------------------------------------------------------------ */
/* Contas e categorias                                                  */
/* ------------------------------------------------------------------ */
export async function createAccount(
  tx: Tx,
  userId: string,
  input: { name: string; type: Account["type"]; initialBalanceCents?: number; creditLimitCents?: number | null; closingDay?: number | null; dueDay?: number | null },
  maxAccounts: number,
): Promise<Account> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new FinanceError("invalid", "Informe o nome da conta.");
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.archivedAt)));
  if (count >= maxAccounts) throw new FinanceError("limit", `Seu plano permite até ${maxAccounts} contas.`);
  if (input.type === "credit_card" && (!input.closingDay || !input.dueDay)) {
    throw new FinanceError("invalid", "Cartões precisam de dia de fechamento e de vencimento.");
  }
  try {
    const [row] = await tx
      .insert(accounts)
      .values({
        userId,
        name,
        type: input.type,
        initialBalanceCents: input.type === "credit_card" ? 0 : (input.initialBalanceCents ?? 0),
        creditLimitCents: input.creditLimitCents ?? null,
        closingDay: input.closingDay ?? null,
        dueDay: input.dueDay ?? null,
      })
      .returning();
    return row;
  } catch (e) {
    if (String((e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code) === "23505") {
      throw new FinanceError("conflict", "Já existe uma conta com esse nome.");
    }
    throw e;
  }
}

export async function archiveAccount(tx: Tx, userId: string, accountId: string) {
  const acc = await getAccount(tx, userId, accountId);
  if (acc.isDefault) throw new FinanceError("invalid", "Defina outra conta como principal antes de arquivar esta.");
  await tx.update(accounts).set({ archivedAt: new Date() }).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
}

export async function createCategory(tx: Tx, userId: string, input: { name: string; kind: "income" | "expense"; icon?: string }) {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new FinanceError("invalid", "Informe o nome da categoria.");
  const slug = slugify(name);
  if (!slug) throw new FinanceError("invalid", "Nome de categoria inválido.");
  const existing = await getCategoryBySlug(tx, userId, input.kind, slug);
  if (existing) throw new FinanceError("conflict", "Essa categoria já existe.");
  const [row] = await tx.insert(categories).values({ userId, kind: input.kind, name, slug, icon: input.icon?.slice(0, 4) || "•" }).returning();
  return row;
}

export async function archiveCategory(tx: Tx, userId: string, categoryId: string) {
  const c = await getCategory(tx, userId, categoryId);
  if (c.isSystem) throw new FinanceError("invalid", "Categorias padrão não podem ser removidas.");
  await tx.update(categories).set({ archivedAt: new Date() }).where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
}

/* ------------------------------------------------------------------ */
/* Recorrências: gera contas a pagar a partir das regras                */
/* ------------------------------------------------------------------ */
export async function createRecurringRule(
  tx: Tx,
  userId: string,
  input: { kind: "income" | "expense"; amountCents: number; description: string; categoryId?: string | null; accountId?: string | null; dayOfMonth: number; startOn: ISODate; endOn?: ISODate | null },
) {
  assertValidAmount(input.amountCents);
  if (input.dayOfMonth < 1 || input.dayOfMonth > 31) throw new FinanceError("invalid", "Dia do mês inválido.");
  if (input.categoryId) {
    const c = await getCategory(tx, userId, input.categoryId);
    if (c.kind !== input.kind) throw new FinanceError("invalid", "A categoria não corresponde ao tipo da recorrência.");
  }
  const accountId = input.accountId ?? (await defaultAccount(tx, userId)).id;
  const acc = await getAccount(tx, userId, accountId);
  if (acc.type === "credit_card" && input.kind === "income") throw new FinanceError("invalid", "Receitas não podem ir para cartão.");
  let nextDueOn = addMonths(input.startOn, 0, input.dayOfMonth);
  if (nextDueOn < input.startOn) nextDueOn = addMonths(input.startOn, 1, input.dayOfMonth);
  const [row] = await tx
    .insert(recurringRules)
    .values({
      userId,
      kind: input.kind,
      amountCents: input.amountCents,
      description: input.description.trim().slice(0, 200),
      categoryId: input.categoryId ?? null,
      accountId,
      dayOfMonth: input.dayOfMonth,
      nextDueOn,
      endOn: input.endOn ?? null,
    })
    .returning();
  return row;
}

/**
 * Para cada regra ativa com vencimento até `horizon`, cria o lançamento pendente
 * e avança a próxima data. Idempotente: a regra só avança se o insert ocorrer na
 * mesma transação.
 */
export async function generateRecurring(tx: Tx, horizon: ISODate): Promise<number> {
  const due = await tx
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.active, true), sql`${recurringRules.nextDueOn} <= ${horizon}`))
    .for("update", { skipLocked: true });
  let created = 0;
  for (const rule of due) {
    let next = rule.nextDueOn;
    while (next <= horizon && (!rule.endOn || next <= rule.endOn)) {
      const [t] = await tx
        .insert(transactions)
        .values({
          userId: rule.userId,
          kind: rule.kind,
          amountCents: rule.amountCents,
          description: rule.description,
          categoryId: rule.categoryId,
          accountId: rule.accountId!,
          occurredOn: next,
          dueOn: next,
          status: "pending",
          recurringRuleId: rule.id,
          source: "system",
        })
        .returning();
      await writeHistory(tx, rule.userId, t.id, "create", "system", null, t, "recorrência");
      created++;
      next = addMonths(next, 1, rule.dayOfMonth);
    }
    const ended = rule.endOn !== null && next > rule.endOn;
    await tx.update(recurringRules).set({ nextDueOn: next, active: !ended }).where(eq(recurringRules.id, rule.id));
  }
  return created;
}
