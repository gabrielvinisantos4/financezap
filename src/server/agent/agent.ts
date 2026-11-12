import { and, between, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { withUser, type Tx } from "../db/client";
import { budgetAlerts, conversationTurns, pendingActions, recurringRules, transactions, users, type Category, type Transaction } from "../db/schema";
import {
  createEntry,
  createRecurringRule,
  deleteEntry,
  deleteAllEntries,
  generateRecurring,
  getTransaction,
  listAccounts,
  listCategories,
  updateEntry,
  type CreateEntryInput,
  type EntryPatch,
} from "../finance/engine";
import {
  availability,
  findDuplicates,
  largestTransaction,
  listRecurring,
  listTransactions,
  monthlyEvolution,
  payables,
  periodSummary,
  recentEntries,
  totalForCategory,
  totalsByCategory,
  expensesByCategoryWithCards,
  totalsByParty,
  totalsByPaymentMethod,
} from "../finance/queries";
import { isPaymentMethod, paymentMethodLabel, PAYMENT_METHOD_ICONS } from "../finance/payment-methods";
import { addDays, addMonths, formatBR, isISODate, resolvePeriod, todayIn, type ISODate, type Period, type PeriodSpec } from "../finance/dates";
import { formatBRL, reaisToCents } from "../finance/money";
import { guessCategorySlug } from "../finance/categories";
import { FinanceError } from "../finance/errors";
import { normalize, interpretByRules, isTrivialMessage } from "./fallback";
import { AIError, type InterpretContext, type Interpreter } from "./llm";
import type { BudgetCommand, Changes, Entry, FixedCommand, Interpretation, Query, Target } from "./schema";
import { budgetStatuses, budgetsReply, newBudgetAlerts, removeBudget, setBudget } from "../finance/budgets";
import * as fmt from "./format";
import type { Reply } from "./format";

/* ------------------------------------------------------------------ */
/* Tipos públicos                                                       */
/* ------------------------------------------------------------------ */
export type IncomingMessage = {
  messageId: string; // id único da mensagem no canal (dedupe/idempotência)
  text?: string | null;
  buttonId?: string | null;
};

export type AgentCapabilities = {
  aiAllowed: boolean; // limite de IA do plano não atingido
  advancedReports: boolean;
};

export type AgentDeps = {
  interpreter: Interpreter | null; // null = sem IA configurada
  now?: () => Date;
  onAiUsage?: (u: { model: string; tokensIn: number; tokensOut: number }) => Promise<void>;
  onAiError?: (err: unknown) => Promise<void>;
};

export type AgentResult = { reply: Reply; usedAi: boolean };

const PENDING_TTL_MIN = 30;
const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/* ------------------------------------------------------------------ */
/* Ações pendentes (confirmações)                                       */
/* ------------------------------------------------------------------ */
type DeleteRange = { from: ISODate; to: ISODate; label: string };

type PendingPayload =
  | { kind: "confirm_create"; entries: CreateEntryInput[]; question: string }
  | { kind: "complete_entry"; entry: Entry; sourceMessageId: string; question: string }
  | { kind: "confirm_update"; txId: string; version: number; patch: EntryPatch; question: string }
  | { kind: "confirm_delete"; txId: string; version: number; wholeGroup: boolean; question: string }
  | { kind: "confirm_delete_all"; count: number; scope?: "expense" | "income" | null; range?: DeleteRange | null; question: string }
  | { kind: "choose_delete_scope"; range?: DeleteRange | null; question: string }
  | { kind: "choose_target"; candidates: { id: string; label: string }[]; next: "update" | "delete"; patch: EntryPatch | null; question: string };

async function openPending(tx: Tx, userId: string, payload: PendingPayload, now: Date) {
  // Só uma pendência ativa por cliente: a nova substitui as anteriores
  await tx
    .update(pendingActions)
    .set({ status: "expired", resolvedAt: now })
    .where(and(eq(pendingActions.userId, userId), eq(pendingActions.status, "pending")));
  const [row] = await tx
    .insert(pendingActions)
    .values({ userId, type: payload.kind, payload, expiresAt: new Date(now.getTime() + PENDING_TTL_MIN * 60_000) })
    .returning();
  return row;
}

async function activePending(tx: Tx, userId: string, now: Date) {
  const [row] = await tx
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.userId, userId), eq(pendingActions.status, "pending"), gt(pendingActions.expiresAt, now)))
    .orderBy(desc(pendingActions.createdAt))
    .limit(1);
  return row ?? null;
}

/** Reivindica a pendência de forma atômica: só um processamento consegue executá-la. */
async function claimPending(tx: Tx, userId: string, id: string, status: "done" | "canceled", now: Date) {
  const [row] = await tx
    .update(pendingActions)
    .set({ status, resolvedAt: now })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId), eq(pendingActions.status, "pending"), gt(pendingActions.expiresAt, now)))
    .returning();
  return row ?? null;
}

function confirmButtons(id: string): fmt.Button[] {
  return [
    { id: `pa:${id}:yes`, title: "✅ Confirmar" },
    { id: `pa:${id}:no`, title: "❌ Cancelar" },
  ];
}

/* ------------------------------------------------------------------ */
/* Agente                                                               */
/* ------------------------------------------------------------------ */
export async function handleMessage(userId: string, msg: IncomingMessage, caps: AgentCapabilities, deps: AgentDeps): Promise<AgentResult> {
  const now = deps.now?.() ?? new Date();

  // Prepara contexto (fora da IA): fuso, data, categorias, contas, histórico curto
  const ctx = await withUser(userId, async (tx) => {
    const [u] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
    const today = todayIn(u?.timezone ?? "America/Sao_Paulo", now);
    const pending = await activePending(tx, userId, now);
    return { today, pending };
  });
  const today = ctx.today;
  const text = (msg.text ?? "").trim();

  // 1) Botões interativos: decisão determinística, sem IA
  if (msg.buttonId) {
    const m = msg.buttonId.match(/^pa:([0-9a-f-]{36}):(yes|no|opt(\d))$/);
    if (!m) return { reply: { text: "Não reconheci essa opção. Pode repetir o pedido?" }, usedAi: false };
    return { reply: await resolvePending(userId, m[1], m[2] === "no" ? "cancel" : m[3] ? Number(m[3]) : "confirm", msg, today, now), usedAi: false };
  }

  if (!text) return { reply: { text: "Não recebi nenhum texto. ✍️ Escreva, mande um áudio ou envie o comprovante. Ex.: \"gastei 50 no posto\"." }, usedAi: false };

  // 2) Respostas a uma pendência (sim / não / número / valor que faltava)
  if (ctx.pending) {
    const quick = interpretByRules(text, { today });
    if (quick.intent === "confirm") return { reply: await resolvePending(userId, ctx.pending.id, "confirm", msg, today, now), usedAi: false };
    if (quick.intent === "cancel") return { reply: await resolvePending(userId, ctx.pending.id, "cancel", msg, today, now), usedAi: false };
    if (quick.intent === "select_option") return { reply: await resolvePending(userId, ctx.pending.id, quick.selected_option!, msg, today, now), usedAi: false };
    const payload = ctx.pending.payload as PendingPayload;
    if (payload.kind === "choose_delete_scope") {
      const n = normalize(text);
      if (/^4[.!]*$/.test(n)) return { reply: await resolvePending(userId, ctx.pending.id, "cancel", msg, today, now), usedAi: false };
      const pick = /\b(gasto|gastos|despesa|despesas)\b/.test(n) ? 1 : /\b(recebimento|recebimentos|receita|receitas|entrada|entradas)\b/.test(n) ? 2 : /\b(tudo|todos|todas|ambos|os dois)\b/.test(n) ? 3 : null;
      if (pick) return { reply: await resolvePending(userId, ctx.pending.id, pick, msg, today, now), usedAi: false };
    }
    if (payload.kind === "complete_entry") {
      const onlyAmount = text.match(/^(?:r\$\s*)?\d[\d.,]*\s*(?:mil|k|reais|real)?[.!]?$/i);
      if (onlyAmount) {
        const { extractAmount } = await import("./fallback");
        const amount = extractAmount(text);
        if (amount) {
          const claimed = await withUser(userId, (tx) => claimPending(tx, userId, ctx.pending!.id, "done", now));
          if (claimed) {
            return { reply: await recordEntries(userId, [{ ...payload.entry, amount }], payload.sourceMessageId, today, now, 1), usedAi: false };
          }
        }
      }
    }
  } else if (isTrivialMessage(text)) {
    const quick = interpretByRules(text, { today });
    if (quick.intent === "confirm" || quick.intent === "cancel" || quick.intent === "select_option") {
      return { reply: { text: "Não há nada aguardando confirmação agora. 🙂 Como posso ajudar?" }, usedAi: false };
    }
  }

  // 3) Interpretação: IA (se disponível e dentro do limite) com contingência por regras
  let interpretation: Interpretation;
  let usedAi = false;
  if (deps.interpreter && caps.aiAllowed && !isTrivialMessage(text)) {
    try {
      const ictx = await buildInterpretContext(userId, today, now, ctx.pending ? ((ctx.pending.payload as PendingPayload).question ?? null) : null);
      const res = await deps.interpreter.interpret(text, ictx);
      interpretation = res.interpretation;
      usedAi = true;
      if (res.usage && deps.onAiUsage) await deps.onAiUsage(res.usage);
    } catch (err) {
      if (deps.onAiError) await deps.onAiError(err);
      interpretation = interpretByRules(text, { today });
      if (interpretation.intent === "unclear" && err instanceof AIError) {
        return { reply: { text: "Tive uma instabilidade para entender sua mensagem agora. 😕 Pode tentar de novo em instantes?" }, usedAi: false };
      }
    }
  } else {
    interpretation = interpretByRules(text, { today });
  }

  await saveTurn(userId, "user", text);
  const reply = await dispatch(userId, interpretation, msg, caps, today, now);
  await saveTurn(userId, "assistant", reply.text);
  return { reply, usedAi };
}

async function buildInterpretContext(userId: string, today: ISODate, now: Date, pendingQuestion: string | null): Promise<InterpretContext> {
  return withUser(userId, async (tx) => {
    const cats = await listCategories(tx, userId);
    const accs = await listAccounts(tx, userId);
    const recent = await listTransactions(tx, userId, { limit: 5 });
    const turns = await tx
      .select()
      .from(conversationTurns)
      .where(and(eq(conversationTurns.userId, userId), gt(conversationTurns.createdAt, new Date(now.getTime() - 2 * 3600_000))))
      .orderBy(desc(conversationTurns.createdAt))
      .limit(6);
    const [y, m, d] = today.split("-").map(Number);
    return {
      today,
      weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
      expenseCategories: cats.filter((c) => c.kind === "expense").map((c) => ({ slug: c.slug, name: c.name })),
      incomeCategories: cats.filter((c) => c.kind === "income").map((c) => ({ slug: c.slug, name: c.name })),
      accounts: accs.map((a) => a.name),
      recentEntries: recent.map((t, i) => `${i + 1}. ${fmt.txLine(t)}`),
      history: turns.reverse().map((t) => ({ role: t.role as "user" | "assistant", content: t.content })),
      pendingQuestion,
    };
  });
}

async function saveTurn(userId: string, role: "user" | "assistant", content: string) {
  await withUser(userId, (tx) => tx.insert(conversationTurns).values({ userId, role, content: content.slice(0, 1000) }));
}

/* ------------------------------------------------------------------ */
/* Despacho por intenção                                                */
/* ------------------------------------------------------------------ */
async function dispatch(userId: string, it: Interpretation, msg: IncomingMessage, caps: AgentCapabilities, today: ISODate, now: Date): Promise<Reply> {
  switch (it.intent) {
    case "record":
      if (!it.entries.length) return { text: it.clarification ?? "Não consegui identificar o lançamento. Tente: \"gastei 50 no mercado\"." };
      return recordEntries(userId, it.entries, msg.messageId, today, now, it.confidence);
    case "query":
      if (!it.query) return { text: it.clarification ?? "Qual informação você quer consultar?" };
      return runQuery(userId, it.query, caps, today);
    case "budget":
      return handleBudget(userId, it.budget, today, it.clarification);
    case "fixed":
      return handleFixed(userId, it.fixed, today, it.clarification);
    case "correct":
      return prepareCorrection(userId, it.target, it.changes, today, now, it.clarification);
    case "delete":
      return prepareDeletion(userId, it.target, today, now);
    case "confirm":
    case "cancel":
    case "select_option":
      return { text: "Não há nada aguardando confirmação agora. 🙂" };
    case "help":
      return { text: fmt.HELP_TEXT };
    case "greeting":
      return { text: "Olá! 👋 Me conte um gasto ou recebimento, ou pergunte algo como \"quanto gastei este mês?\". Digite *ajuda* para ver exemplos." };
    case "out_of_scope":
      return { text: "Eu cuido só das suas finanças por aqui. 🙂 Posso registrar gastos e receitas ou responder perguntas sobre eles." };
    case "unclear":
    default:
      return { text: it.clarification ?? "Não entendi. 🤔 Você pode escrever, por exemplo: \"gastei 50 no posto\" ou \"quanto gastei hoje?\". Digite *ajuda* para mais exemplos." };
  }
}

/* ------------------------- Limites de gasto ------------------------- */
async function handleBudget(userId: string, cmd: BudgetCommand | null, today: ISODate, clarification: string | null): Promise<Reply> {
  if (!cmd) return { text: clarification ?? 'Quer definir um limite? Ex.: "limite de 800 para mercado" ou "meu limite do mês é 3 mil".' };
  return withUser(userId, async (tx) => {
    if (cmd.action === "status") {
      const list = await budgetStatuses(tx, userId, today);
      const filtered = cmd.category ? list.filter((b) => b.slug === cmd.category) : list;
      return { text: budgetsReply(filtered.length ? filtered : list, today) };
    }
    if (cmd.action === "remove") {
      const name = await removeBudget(tx, userId, cmd.category);
      return { text: name ? `🗑️ Limite de ${name} removido.` : "Não encontrei esse limite. Digite *meus limites* para ver os que existem." };
    }
    if (!cmd.amount) return { text: clarification ?? "Qual o valor do limite? Ex.: \"limite de 800 para mercado\"." };
    const cents = reaisToCents(cmd.amount);
    const r = await setBudget(tx, userId, cmd.category, cents);
    const [status] = (await budgetStatuses(tx, userId, today)).filter((b) => (cmd.category ? b.slug === cmd.category : b.categoryId === null));
    const lines = [`🎯 Limite ${r.created ? "definido" : "atualizado"}!`, "", `${r.icon} ${r.name}: ${formatBRL(cents)} por mês`];
    if (status) lines.push(`Já usado em ${today.slice(5, 7)}/${today.slice(0, 4)}: ${formatBRL(status.spentCents)} (${status.pct}%)`);
    lines.push("", "Eu aviso quando chegar em 80% e em 100%.");
    return { text: lines.join("\n") };
  });
}

/* -------------------------- Contas fixas --------------------------- */
const sameName = (a: string, b: string) => {
  const x = normalize(a);
  const y = normalize(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

async function handleFixed(userId: string, cmd: FixedCommand | null, today: ISODate, clarification: string | null): Promise<Reply> {
  if (!cmd) return { text: clarification ?? 'Quer cadastrar uma conta fixa? Ex.: "meu aluguel é 1.200 todo dia 10".' };
  return withUser(userId, async (tx) => {
    const rules = await listRecurring(tx, userId);
    const cats = await listCategories(tx, userId);
    const catOf = (id: string | null) => cats.find((c) => c.id === id);

    if (cmd.action === "list") {
      if (!rules.length) return { text: 'Você ainda não tem contas fixas. 🔁\n\nExemplos:\n• "meu aluguel é 1.200 todo dia 10"\n• "internet 120 todo mês dia 5"\n• "recebo 3 mil de salário todo dia 5"' };
      const exp = rules.filter((r) => r.kind === "expense");
      const inc = rules.filter((r) => r.kind === "income");
      const line = (r: (typeof rules)[number]) => `• Dia ${r.dayOfMonth} · ${catOf(r.categoryId)?.icon ?? "🔁"} ${r.description} · ${formatBRL(r.amountCents)}`;
      const lines = ["🔁 Suas contas fixas", ""];
      if (exp.length) lines.push(...exp.map(line), "", `Total de despesas fixas: ${formatBRL(exp.reduce((t, r) => t + r.amountCents, 0))} por mês`);
      if (inc.length) lines.push("", "💰 Entradas fixas", ...inc.map(line));
      return { text: lines.join("\n").trim() };
    }

    const matches = rules.filter(
      (r) => r.kind === cmd.kind && ((cmd.description && sameName(r.description, cmd.description)) || (!cmd.description && cmd.category && catOf(r.categoryId)?.slug === cmd.category)),
    );

    if (cmd.action === "remove") {
      if (!matches.length) return { text: "Não encontrei essa conta fixa. Mande *minhas contas fixas* para ver a lista." };
      if (matches.length > 1) return { text: `Encontrei mais de uma: ${matches.map((m) => m.description).join(", ")}. Qual delas? Escreva o nome exato.` };
      const rule = matches[0];
      await tx.update(recurringRules).set({ active: false, updatedAt: new Date() }).where(and(eq(recurringRules.id, rule.id), eq(recurringRules.userId, userId)));
      // Contas a pagar futuras ainda não pagas dessa conta fixa deixam de valer
      const future = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.recurringRuleId, rule.id), eq(transactions.status, "pending"), isNull(transactions.deletedAt), sql`${transactions.dueOn} >= ${today}`));
      for (const f of future) await deleteEntry(tx, userId, f.id, "agent", { reason: "conta fixa encerrada" });
      return { text: `🗑️ Conta fixa *${rule.description}* encerrada. Os meses já pagos continuam no histórico.` };
    }

    // set
    if (!cmd.amount || !cmd.day) {
      const what = cmd.description ?? "essa conta";
      const missing = !cmd.amount && !cmd.day ? "o valor e o dia do vencimento" : !cmd.amount ? "o valor" : "o dia do vencimento";
      return { text: `Para cadastrar ${what} como conta fixa, me diga ${missing}. Ex.: "${(cmd.description ?? "aluguel").toLowerCase()} ${cmd.amount ? String(cmd.amount).replace(".", ",") : "1.200"} todo dia ${cmd.day ?? 10}".` };
    }
    const amountCents = reaisToCents(cmd.amount);
    const description = (cmd.description?.trim() || (cmd.kind === "expense" ? "Conta fixa" : "Entrada fixa")).slice(0, 120);
    const slug = cmd.category && cats.some((c) => c.kind === cmd.kind && c.slug === cmd.category) ? cmd.category : guessCategorySlug(description, cmd.kind);
    const category = cats.find((c) => c.kind === cmd.kind && c.slug === slug) ?? null;

    let verb = "cadastrada";
    let rule;
    if (matches.length === 1) {
      verb = "atualizada";
      const old = matches[0];
      let next = addMonths(today, 0, cmd.day);
      if (next < today) next = addMonths(today, 1, cmd.day);
      // não volta a gerar um mês que já foi gerado
      if (old.nextDueOn > next) next = addMonths(old.nextDueOn, 0, cmd.day);
      [rule] = await tx
        .update(recurringRules)
        .set({ amountCents, dayOfMonth: cmd.day, nextDueOn: next, categoryId: category?.id ?? old.categoryId, updatedAt: new Date() })
        .where(and(eq(recurringRules.id, old.id), eq(recurringRules.userId, userId)))
        .returning();
    } else {
      rule = await createRecurringRule(tx, userId, { kind: cmd.kind, amountCents, description, categoryId: category?.id ?? null, dayOfMonth: cmd.day, startOn: today });
    }
    // Se vence nos próximos 7 dias, já aparece como conta a pagar
    await generateRecurring(tx, addDays(today, 7));
    const [fresh] = await tx.select().from(recurringRules).where(eq(recurringRules.id, rule.id));
    const pendingNow = await tx
      .select({ dueOn: transactions.dueOn })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.recurringRuleId, rule.id), eq(transactions.status, "pending"), isNull(transactions.deletedAt)))
      .orderBy(transactions.dueOn)
      .limit(1);
    const nextDue = pendingNow[0]?.dueOn ?? fresh.nextDueOn;
    const isIncome = cmd.kind === "income";
    return {
      text: [
        `🔁 ${isIncome ? "Entrada fixa" : "Conta fixa"} ${verb}!`,
        "",
        `${category?.icon ?? "🔁"} ${description}`,
        `💰 ${formatBRL(amountCents)} por mês`,
        `📅 Todo dia ${cmd.day} · próximo: ${formatBR(nextDue)}`,
        "",
        isIncome
          ? "Ela entra como valor a receber alguns dias antes. Quando cair, é só me avisar: \"recebi o salário\"."
          : `Ela aparece nas contas a pagar 7 dias antes do vencimento. Quando pagar, é só me dizer: "paguei ${description.toLowerCase()}".`,
      ].join("\n"),
    };
  });
}

/**
 * "Paguei o aluguel": se existe uma conta fixa pendente perto dessa data com o mesmo nome
 * (ou a mesma categoria, quando só há uma), dá baixa nela em vez de lançar outra despesa.
 */
async function settleFixedBill(tx: Tx, userId: string, entry: Entry, date: ISODate, categoryId: string | null, opts: { byNameOnly?: boolean } = {}): Promise<Transaction | null> {
  const candidates = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.kind, entry.kind),
        eq(transactions.status, "pending"),
        isNotNull(transactions.recurringRuleId),
        isNull(transactions.deletedAt),
        between(transactions.dueOn, addDays(date, -20), addDays(date, 25)),
      ),
    )
    .orderBy(transactions.dueOn);
  if (!candidates.length) return null;
  const text = `${entry.description} ${entry.merchant ?? ""} ${entry.counterparty ?? ""}`;
  const byName = candidates.filter((c) => normalize(text).split(" ").some((w) => w.length >= 3 && normalize(c.description).split(" ").includes(w)));
  const byCat = categoryId ? candidates.filter((c) => c.categoryId === categoryId) : [];
  const pick = byName.length ? byName[0] : !opts.byNameOnly && byCat.length === 1 ? byCat[0] : null;
  if (!pick) return null;
  return updateEntry(
    tx,
    userId,
    pick.id,
    { status: "paid", occurredOn: date, amountCents: entry.amount ? reaisToCents(entry.amount) : pick.amountCents, paymentMethod: entry.payment_method ?? pick.paymentMethod },
    "agent",
    { reason: "conta fixa paga" },
  );
}

async function fixedPaidReply(tx: Tx, userId: string, settled: Transaction, cats: Category[], today: ISODate): Promise<Reply> {
  const c = cats.find((x) => x.id === settled.categoryId);
  const reply = fmt.recordedReply([settled], c ? { name: c.name, icon: c.icon } : null, {});
  const title = settled.kind === "income" ? "✅ Entrada fixa recebida!" : "✅ Conta fixa paga!";
  let text = reply.text.replace(/^✅ [^\n]+/, title).replace("Seu lançamento foi salvo com sucesso.", "Dei baixa na conta fixa deste mês — não lancei em dobro.");
  if (settled.kind === "expense") {
    const alerts = await newBudgetAlerts(tx, userId, today, [settled.categoryId]);
    if (alerts.length) text += `\n\n${alerts.join("\n\n")}`;
  }
  return { text };
}

/* ---------------------------- Registro ----------------------------- */
function validDate(d: string | null, today: ISODate): ISODate | null {
  if (!d || !isISODate(d)) return null;
  if (d < addMonths(today, -36) || d > addMonths(today, 12)) return null;
  return d;
}

function matchAccount(hint: string | null, accounts: { id: string; name: string }[]): string | null {
  if (!hint) return null;
  const h = normalize(hint);
  const exact = accounts.find((a) => normalize(a.name) === h);
  if (exact) return exact.id;
  const partial = accounts.filter((a) => normalize(a.name).includes(h) || h.includes(normalize(a.name)));
  return partial.length === 1 ? partial[0].id : null;
}

function resolveCategorySlug(entry: Entry, cats: Category[]): string {
  const valid = cats.filter((c) => c.kind === entry.kind).map((c) => c.slug);
  if (entry.category && valid.includes(entry.category)) return entry.category;
  return guessCategorySlug(`${entry.description} ${entry.merchant ?? ""} ${entry.counterparty ?? ""}`, entry.kind);
}

const METHOD_DESCRIPTION: Record<string, string> = {
  credito: "Compra no cartão",
  debito: "Compra no débito",
  pix: "Pagamento no Pix",
  dinheiro: "Pagamento em dinheiro",
  boleto: "Pagamento de boleto",
  transferencia: "Transferência",
};

/** Sem descrição útil ("1.000 no cartão"), usa a forma de pagamento para o lançamento não virar só "Despesa". */
function describeEntry(e: Entry): string {
  const d = e.description?.trim() ?? "";
  const generic = !d || /^(despesa|receita|gasto|compra|pagamento|outros?)$/i.test(d);
  if (generic && e.kind === "expense" && e.payment_method) return METHOD_DESCRIPTION[e.payment_method] ?? "Despesa";
  if (generic && e.kind === "income" && e.payment_method === "pix") return "Recebimento no Pix";
  return d || (e.kind === "expense" ? "Despesa" : "Receita");
}

async function recordEntries(userId: string, entries: Entry[], messageId: string, today: ISODate, now: Date, confidence: number): Promise<Reply> {
  // Faltou valor? Se for "paguei o aluguel" e há conta fixa pendente com esse nome, usa o valor dela.
  const missing = entries.find((e) => e.amount === null);
  if (missing && entries.length === 1) {
    const settled = await withUser(userId, async (tx) => {
      const date = validDate(missing.date, today) ?? today;
      const cats = await listCategories(tx, userId);
      const slug = resolveCategorySlug(missing, cats);
      const cat = cats.find((c) => c.kind === missing.kind && c.slug === slug) ?? null;
      const t = await settleFixedBill(tx, userId, missing, date, cat?.id ?? null);
      return t ? fixedPaidReply(tx, userId, t, cats, today) : null;
    });
    if (settled) return settled;
  }
  if (missing) {
    const question = missing.kind === "expense" ? `Qual foi o valor de "${missing.description}"?` : `Qual foi o valor recebido${missing.counterparty ? ` de ${missing.counterparty}` : ""}?`;
    if (entries.length === 1) {
      await withUser(userId, (tx) => openPending(tx, userId, { kind: "complete_entry", entry: missing, sourceMessageId: messageId, question }, now));
    }
    return { text: question };
  }

  return withUser(userId, async (tx) => {
    const cats = await listCategories(tx, userId);
    const accs = await listAccounts(tx, userId);
    const inputs: CreateEntryInput[] = entries.map((e, i) => {
      const date = validDate(e.date, today) ?? today;
      const future = date > today;
      return {
        kind: e.kind,
        amountCents: reaisToCents(e.amount!),
        description: describeEntry(e),
        merchant: e.merchant,
        counterparty: e.counterparty,
        categorySlug: resolveCategorySlug(e, cats),
        accountId: matchAccount(e.account_hint, accs),
        occurredOn: date,
        status: future ? "pending" : "paid",
        dueOn: future ? date : null,
        paymentMethod: e.payment_method,
        installments: e.installments,
        source: "whatsapp",
        sourceMessageId: entries.length > 1 ? `${messageId}#${i + 1}` : messageId,
      };
    });

    // "Paguei o aluguel": dá baixa na conta fixa pendente em vez de duplicar
    if (entries.length === 1 && !entries[0].installments && confidence >= 0.55) {
      const cat = cats.find((c) => c.kind === inputs[0].kind && c.slug === inputs[0].categorySlug) ?? null;
      const settled = await settleFixedBill(tx, userId, entries[0], inputs[0].occurredOn, cat?.id ?? null);
      if (settled) return fixedPaidReply(tx, userId, settled, cats, today);
    }

    // Interpretação incerta ou valor muito alto: confirma antes de gravar
    const big = inputs.some((x) => x.amountCents >= 5_000_000);
    if (confidence < 0.55 || big) {
      const lines = inputs.map((x) => `• ${x.kind === "expense" ? "Despesa" : "Receita"}: ${x.description} · ${formatBRL(x.amountCents)} · ${formatBR(x.occurredOn)}${x.installments ? ` · ${x.installments}x` : ""}`);
      const question = `Confere antes de eu salvar?\n\n${lines.join("\n")}`;
      const p = await openPending(tx, userId, { kind: "confirm_create", entries: inputs, question }, now);
      return { text: question, buttons: confirmButtons(p.id) };
    }
    return createAndReply(tx, userId, inputs, today, cats);
  });
}

async function createAndReply(tx: Tx, userId: string, inputs: CreateEntryInput[], today: ISODate, cats?: Category[]): Promise<Reply> {
  const categoriesList = cats ?? (await listCategories(tx, userId));
  const results: { rows: Transaction[]; category: { name: string; icon: string } | null; input: CreateEntryInput }[] = [];
  for (const input of inputs) {
    let rows: Transaction[];
    // Idempotência: a mesma mensagem nunca gera dois lançamentos
    const existing = input.sourceMessageId
      ? await tx.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.sourceMessageId, input.sourceMessageId)))
      : [];
    if (existing.length) rows = existing;
    else rows = await createEntry(tx, userId, input, "agent", today);
    const c = categoriesList.find((x) => x.id === rows[0].categoryId);
    results.push({ rows, category: c ? { name: c.name, icon: c.icon } : null, input });
  }
  let reply: Reply;
  if (results.length === 1) {
    const r = results[0];
    reply = fmt.recordedReply(r.rows, r.category, { merchant: r.input.merchant, counterparty: r.input.counterparty });
  } else {
    reply = fmt.multiRecordedReply(results);
  }
  // Limites de gasto: só despesas pagas deste mês mexem no que já foi usado
  const monthStart = today.slice(0, 8) + "01";
  const touched = results
    .flatMap((r) => r.rows)
    .filter((t) => t.kind === "expense" && t.status === "paid" && t.occurredOn >= monthStart && t.occurredOn <= today)
    .map((t) => t.categoryId);
  if (touched.length) {
    const alerts = await newBudgetAlerts(tx, userId, today, touched);
    if (alerts.length) reply = { ...reply, text: `${reply.text}\n\n${alerts.join("\n\n")}` };
  }
  return reply;
}

/* ---------------------------- Consultas ---------------------------- */
function toPeriodSpec(q: Query): PeriodSpec {
  const p = q.period;
  if (!p) return { type: "this_month" };
  switch (p.type) {
    case "month":
      return { type: "month", month: p.month ?? 1, year: p.year };
    case "last_n_days":
      return { type: "last_n_days", days: p.days ?? 7 };
    case "custom":
      if (p.from && p.to) return { type: "custom", from: p.from, to: p.to };
      return { type: "this_month" };
    default:
      return { type: p.type };
  }
}

async function methodTotalReply(tx: Tx, userId: string, period: Period, kind: "income" | "expense", method: string): Promise<Reply> {
  const rows = await listTransactions(tx, userId, { period, kind, status: "paid", paymentMethod: method, limit: 500 });
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const via: Record<string, string> = { credito: "no cartão de crédito", debito: "no débito", pix: "no Pix", dinheiro: "em dinheiro", boleto: "em boleto", transferencia: "por transferência" };
  const how = via[method] ?? `com ${paymentMethodLabel(method) ?? method}`;
  const icon = isPaymentMethod(method) ? PAYMENT_METHOD_ICONS[method] : "💳";
  if (!rows.length) return { text: `Não encontrei ${kind === "expense" ? "gastos" : "entradas"} ${how} ${period.label}.` };
  const verb = kind === "expense" ? "Você gastou" : "Entraram";
  return { text: `${icon} ${verb} ${formatBRL(total)} ${how} ${period.label}.\n${rows.length} lançamento${rows.length === 1 ? "" : "s"}.` };
}

async function runQuery(userId: string, q: Query, caps: AgentCapabilities, today: ISODate): Promise<Reply> {
  let period;
  try {
    period = resolvePeriod(toPeriodSpec(q), today);
  } catch {
    return { text: "Não consegui entender o período. Pode dizer de outro jeito? Ex.: \"em outubro\" ou \"nesta semana\"." };
  }
  return withUser(userId, async (tx) => {
    switch (q.type) {
      case "summary":
        return fmt.summaryReply(period.label, await periodSummary(tx, userId, period));
      case "by_payment_method":
        return fmt.paymentMethodsReply(period.label, await totalsByPaymentMethod(tx, userId, period, "expense"));
      case "expenses_total": {
        if (q.payment_method) return methodTotalReply(tx, userId, period, "expense", q.payment_method);
        const s = await periodSummary(tx, userId, period);
        const count = (await listTransactions(tx, userId, { period, kind: "expense", status: "paid", limit: 500 })).length;
        return fmt.totalReply("expense", period.label, s.netExpenseCents, count);
      }
      case "income_total": {
        if (q.payment_method) return methodTotalReply(tx, userId, period, "income", q.payment_method);
        const s = await periodSummary(tx, userId, period);
        const count = (await listTransactions(tx, userId, { period, kind: "income", status: "paid", limit: 500 })).length;
        return fmt.totalReply("income", period.label, s.incomeCents, count);
      }
      case "by_category":
        return fmt.categoriesReply(period.label, "expense", await expensesByCategoryWithCards(tx, userId, period));
      case "category_total": {
        if (!q.category) return fmt.categoriesReply(period.label, "expense", await expensesByCategoryWithCards(tx, userId, period));
        const kind = (await listCategories(tx, userId)).find((c) => c.slug === q.category)?.kind ?? "expense";
        const c = await totalForCategory(tx, userId, period, kind, q.category);
        const name = (await listCategories(tx, userId, kind)).find((x) => x.slug === q.category)?.name ?? q.category;
        if (!c) return { text: `Não encontrei ${kind === "expense" ? "gastos" : "receitas"} com ${name} ${period.label}.` };
        return { text: `${c.icon} ${kind === "expense" ? "Você gastou" : "Você recebeu"} ${formatBRL(c.totalCents)} com ${c.name} ${period.label} (${c.count} lançamento${c.count === 1 ? "" : "s"}).` };
      }
      case "by_merchant":
        return fmt.partiesReply(period.label, "expense", await totalsByParty(tx, userId, period, "expense", q.search), q.search);
      case "by_client":
        return fmt.partiesReply(period.label, "income", await totalsByParty(tx, userId, period, "income", q.search), q.search);
      case "largest_expense":
        return fmt.largestReply("expense", period.label, await largestTransaction(tx, userId, period, "expense"));
      case "largest_income":
        return fmt.largestReply("income", period.label, await largestTransaction(tx, userId, period, "income"));
      case "recent": {
        const kind = q.category === "expense" || q.category === "income" ? q.category : undefined;
        return fmt.recentReply(await listTransactions(tx, userId, { limit: q.limit ?? 10, kind, paymentMethod: q.payment_method ?? undefined }));
      }
      case "balance":
        return fmt.availabilityReply(await availability(tx, userId, today));
      case "payables":
        return fmt.payablesReply(await payables(tx, userId, addDays(today, 30)), today);
      case "recurring": {
        const rules = await listRecurring(tx, userId);
        if (!rules.length) return { text: 'Você ainda não tem contas fixas. Ex.: "meu aluguel é 1.200 todo dia 10".' };
        return { text: ["🔁 Recorrentes", "", ...rules.map((r) => `• Dia ${r.dayOfMonth} · ${r.description} · ${formatBRL(r.amountCents)}`)].join("\n") };
      }
      case "evolution": {
        if (!caps.advancedReports) return { text: "A evolução mensal faz parte dos relatórios avançados do plano Pro. Você pode ver o resumo do mês com \"qual meu resultado do mês?\"." };
        return fmt.evolutionReply(await monthlyEvolution(tx, userId, today, q.limit ?? 6));
      }
    }
  });
}

/* ----------------------- Correção e exclusão ----------------------- */
async function resolveTargets(tx: Tx, userId: string, target: Target | null, today: ISODate): Promise<{ candidates: (Transaction & { duplicateOf?: string })[]; reason?: string }> {
  const ref = target?.reference ?? "last";
  if (ref === "duplicate") {
    const pairs = await findDuplicates(tx, userId, 60, today);
    const list: (Transaction & { duplicateOf?: string })[] = [];
    for (const p of pairs.slice(0, 3)) list.push({ ...(await getTransaction(tx, userId, p.b)), duplicateOf: p.a });
    return { candidates: list, reason: "duplicate" };
  }
  if (ref === "last" || ref === "last_expense" || ref === "last_income") {
    const kind = ref === "last_expense" ? "expense" : ref === "last_income" ? "income" : (target?.kind ?? undefined);
    const rows = await recentEntries(tx, userId, { kind: kind ?? undefined, limit: 1 });
    return { candidates: rows };
  }
  // match: usa valor / descrição / data / tipo como critérios auxiliares
  const pool = await recentEntries(tx, userId, { kind: target?.kind ?? undefined, limit: 100 });
  const amountCents = target?.amount ? reaisToCents(target.amount) : null;
  const desc = target?.description ? normalize(target.description) : null;
  const scored = pool
    .map((t) => {
      let score = 0;
      if (amountCents !== null) score += t.amountCents === amountCents ? 3 : -5;
      if (target?.date) score += t.occurredOn === target.date ? 2 : -2;
      if (desc) {
        const hay = normalize(`${t.description} ${t.merchant ?? ""} ${t.counterparty ?? ""}`);
        score += hay.includes(desc) || desc.split(" ").some((w) => w.length > 3 && hay.includes(w)) ? 2 : -1;
      }
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.t.createdAt > a.t.createdAt ? 1 : -1));
  if (!scored.length) return { candidates: [] };
  const top = scored[0].score;
  return { candidates: scored.filter((x) => x.score === top).slice(0, 5).map((x) => x.t) };
}

async function changesToPatch(tx: Tx, userId: string, base: Transaction, changes: Changes): Promise<EntryPatch> {
  const patch: EntryPatch = {};
  if (changes.amount) patch.amountCents = reaisToCents(changes.amount);
  if (changes.description) patch.description = changes.description;
  if (changes.merchant) patch.merchant = changes.merchant;
  if (changes.counterparty) patch.counterparty = changes.counterparty;
  if (changes.date && isISODate(changes.date)) patch.occurredOn = changes.date;
  if (changes.kind && changes.kind !== base.kind && (base.kind === "income" || base.kind === "expense")) patch.kind = changes.kind;
  if (changes.payment_method) patch.paymentMethod = changes.payment_method;
  const kind = patch.kind ?? base.kind;
  if (kind === "income" || kind === "expense") {
    const cats = await listCategories(tx, userId, kind);
    if (changes.category && cats.some((c) => c.slug === changes.category)) patch.categorySlug = changes.category;
    else if (changes.merchant && !changes.category) {
      const guessed = guessCategorySlug(changes.merchant, kind);
      if (guessed !== "outros" && guessed !== "outras-receitas") patch.categorySlug = guessed;
    }
    if (patch.merchant && base.description && base.merchant && normalize(base.description) === normalize(base.merchant)) {
      patch.description = patch.merchant.charAt(0).toUpperCase() + patch.merchant.slice(1);
    }
  }
  return patch;
}

async function describePatch(tx: Tx, userId: string, base: Transaction, patch: EntryPatch): Promise<string[]> {
  const lines: string[] = [];
  if (patch.amountCents !== undefined) lines.push(`💰 Valor: ${formatBRL(base.amountCents)} → ${formatBRL(patch.amountCents)}`);
  if (patch.categorySlug) {
    const cats = await listCategories(tx, userId);
    const from = cats.find((c) => c.id === base.categoryId);
    const to = cats.find((c) => c.slug === patch.categorySlug && c.kind === (patch.kind ?? base.kind));
    if (to && to.id !== from?.id) lines.push(`🏷️ Categoria: ${from?.name ?? "—"} → ${to.name}`);
  }
  if (patch.merchant) lines.push(`📍 Local: ${base.merchant ?? "—"} → ${patch.merchant}`);
  if (patch.counterparty) lines.push(`👤 Pagador: ${base.counterparty ?? "—"} → ${patch.counterparty}`);
  if (patch.description && patch.description !== base.description) lines.push(`📝 Descrição: ${base.description} → ${patch.description}`);
  if (patch.occurredOn) lines.push(`📅 Data: ${formatBR(base.occurredOn)} → ${formatBR(patch.occurredOn)}`);
  if (patch.kind) lines.push(`🔁 Tipo: ${base.kind === "income" ? "receita" : "despesa"} → ${patch.kind === "income" ? "receita" : "despesa"}`);
  if (patch.paymentMethod) lines.push(`💳 Forma de pagamento: ${patch.paymentMethod}`);
  return lines;
}

async function proposeUpdate(tx: Tx, userId: string, t: Transaction, patch: EntryPatch, now: Date): Promise<Reply> {
  const lines = await describePatch(tx, userId, t, patch);
  if (!lines.length) return { text: "Não identifiquei o que mudar nesse lançamento. Me diga o valor ou a informação correta." };
  const question = `Vou corrigir este lançamento:\n${fmt.describeTx(t)}\n\n${lines.join("\n")}\n\nConfirma?`;
  const p = await openPending(tx, userId, { kind: "confirm_update", txId: t.id, version: t.version, patch, question }, now);
  return { text: question, buttons: confirmButtons(p.id) };
}

async function proposeDelete(tx: Tx, userId: string, t: Transaction & { duplicateOf?: string }, now: Date): Promise<Reply> {
  const group = t.installmentGroupId && t.installmentTotal ? ` (parcela ${t.installmentNumber}/${t.installmentTotal}; as demais parcelas também serão removidas)` : "";
  const dup = t.duplicateOf ? "Encontrei um lançamento repetido. Vou excluir a cópia mais recente:\n" : "Vou excluir este lançamento:\n";
  const question = `${dup}${fmt.describeTx(t)}${group}\n\nConfirma a exclusão?`;
  const p = await openPending(tx, userId, { kind: "confirm_delete", txId: t.id, version: t.version, wholeGroup: Boolean(t.installmentGroupId), question }, now);
  return { text: question, buttons: confirmButtons(p.id) };
}

async function proposeChoice(tx: Tx, userId: string, candidates: Transaction[], next: "update" | "delete", patch: EntryPatch | null, now: Date): Promise<Reply> {
  const options = candidates.slice(0, 3).map((c) => ({ id: c.id, label: fmt.txLine(c) }));
  const question = `Encontrei mais de um lançamento. Qual deles?\n\n${options.map((o, i) => `${i + 1}. ${o.label}`).join("\n")}\n\nResponda com o número.`;
  const p = await openPending(tx, userId, { kind: "choose_target", candidates: options, next, patch, question }, now);
  return {
    text: question,
    buttons: options.map((_, i) => ({ id: `pa:${p.id}:opt${i + 1}`, title: `Opção ${i + 1}` })),
  };
}

async function prepareCorrection(userId: string, target: Target | null, changes: Changes | null, today: ISODate, now: Date, clarification: string | null): Promise<Reply> {
  const hasChange = changes && Object.values(changes).some((v) => v !== null);
  if (!hasChange) return { text: clarification ?? "O que você quer corrigir? Ex.: \"errei o valor, era 70\" ou \"a categoria é mercado\"." };
  return withUser(userId, async (tx) => {
    const { candidates } = await resolveTargets(tx, userId, target, today);
    if (!candidates.length) return { text: "Não encontrei esse lançamento. Você pode me dizer o valor ou a descrição dele?" };
    if (candidates.length > 1) {
      const patch = await changesToPatch(tx, userId, candidates[0], changes!);
      return proposeChoice(tx, userId, candidates, "update", patch, now);
    }
    const patch = await changesToPatch(tx, userId, candidates[0], changes!);
    return proposeUpdate(tx, userId, candidates[0], patch, now);
  });
}

/** Conta lançamentos ativos por tipo (gastos, recebimentos e o total), opcionalmente num período. */
async function countEntries(tx: Tx, userId: string, range: DeleteRange | null) {
  const rows = await tx
    .select({ kind: transactions.kind, c: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), range ? between(transactions.occurredOn, range.from, range.to) : undefined))
    .groupBy(transactions.kind);
  const of = (k: string) => rows.find((r) => r.kind === k)?.c ?? 0;
  return { expense: of("expense"), income: of("income"), all: rows.reduce((s, r) => s + r.c, 0) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Apagar tudo": sem tipo definido, oferece só gastos, só recebimentos, tudo ou cancelar; com tipo, pede confirmação. */
async function proposeDeleteAll(tx: Tx, userId: string, scope: "expense" | "income" | null, range: DeleteRange | null, now: Date, chosen = false): Promise<Reply> {
  const n = await countEntries(tx, userId, range);
  const inRange = range ? ` (${range.label})` : "";
  if (!n.all) return { text: `Você não tem lançamentos para apagar${inRange}. 🙂` };
  if (!chosen && scope === null && n.expense > 0 && n.income > 0) {
    const question = [
      `🗑️ O que você quer apagar${inRange}?`,
      "",
      `1. Só os gastos (${plural(n.expense, "lançamento", "lançamentos")})`,
      `2. Só os recebimentos (${plural(n.income, "lançamento", "lançamentos")})`,
      `3. Tudo (${plural(n.all, "lançamento", "lançamentos")})`,
      "4. Cancelar, não apagar nada",
      "",
      "Toque em *Escolher* ou responda com o número.",
    ].join("\n");
    const p = await openPending(tx, userId, { kind: "choose_delete_scope", range, question }, now);
    return {
      text: question,
      buttons: [
        { id: `pa:${p.id}:opt1`, title: "Só gastos" },
        { id: `pa:${p.id}:opt2`, title: "Só recebimentos" },
        { id: `pa:${p.id}:opt3`, title: "Tudo" },
        { id: `pa:${p.id}:no`, title: "Cancelar" },
      ],
    };
  }
  const count = scope === "expense" ? n.expense : scope === "income" ? n.income : n.all;
  if (!count) return { text: scope === "expense" ? `Você não tem gastos para apagar${inRange}. 🙂` : `Você não tem recebimentos para apagar${inRange}. 🙂` };
  const what =
    scope === "expense"
      ? `*todos os seus gastos*${inRange} (${plural(count, "lançamento", "lançamentos")})`
      : scope === "income"
        ? `*todos os seus recebimentos*${inRange} (${plural(count, "lançamento", "lançamentos")})`
        : range
          ? `*todos os ${plural(count, "lançamento", "lançamentos")}*${inRange}, gastos e recebimentos`
          : `*todos os ${plural(count, "lançamento", "lançamentos")}* da sua conta (gastos e recebimentos)`;
  const question = `⚠️ Vou apagar ${what}.\n\nSuas contas, categorias, limites e contas fixas continuam cadastrados.\n\nConfirma? Isso não pode ser desfeito por aqui.`;
  const p = await openPending(tx, userId, { kind: "confirm_delete_all", count, scope, range, question }, now);
  return { text: question, buttons: confirmButtons(p.id) };
}

async function prepareDeletion(userId: string, target: Target | null, today: ISODate, now: Date): Promise<Reply> {
  return withUser(userId, async (tx) => {
    if (target?.reference === "all") {
      let range: DeleteRange | null = null;
      if (target.period) {
        const per = resolvePeriod(target.period as PeriodSpec, today);
        range = { from: per.from, to: per.to, label: per.label };
      }
      return proposeDeleteAll(tx, userId, target.kind, range, now);
    }
    const { candidates, reason } = await resolveTargets(tx, userId, target, today);
    if (!candidates.length) {
      return { text: reason === "duplicate" ? "Não encontrei lançamentos repetidos recentes. Se quiser, me diga o valor do lançamento duplicado." : "Não encontrei esse lançamento. Me diga o valor ou a descrição dele." };
    }
    if (candidates.length > 1) return proposeChoice(tx, userId, candidates, "delete", null, now);
    return proposeDelete(tx, userId, candidates[0], now);
  });
}

/* ----------------------- Execução de pendências --------------------- */
async function resolvePending(userId: string, pendingId: string, decision: "confirm" | "cancel" | number, msg: IncomingMessage, today: ISODate, now: Date): Promise<Reply> {
  return withUser(userId, async (tx) => {
    const [row] = await tx.select().from(pendingActions).where(and(eq(pendingActions.id, pendingId), eq(pendingActions.userId, userId)));
    if (!row) return { text: "Essa opção não está mais disponível." };
    if (row.status !== "pending") return { text: row.status === "done" ? "Isso já foi feito. ✅" : "Essa solicitação já foi encerrada." };
    if (row.expiresAt <= now) {
      await tx.update(pendingActions).set({ status: "expired", resolvedAt: now }).where(eq(pendingActions.id, row.id));
      return { text: "Essa confirmação expirou. Pode repetir o pedido?" };
    }
    const payload = row.payload as PendingPayload;

    if (decision === "cancel") {
      await claimPending(tx, userId, row.id, "canceled", now);
      return { text: "Tudo bem, cancelei. Nada foi alterado. 👍" };
    }

    if (payload.kind === "choose_delete_scope") {
      const scopes = ["expense", "income", null] as const;
      const idx = typeof decision === "number" ? decision - 1 : -1;
      if (idx === 3) {
        await claimPending(tx, userId, row.id, "canceled", now);
        return { text: "Tudo bem, cancelei. Nada foi apagado. 👍" };
      }
      if (idx < 0 || idx > 2) return { text: "Escolha 1 (só gastos), 2 (só recebimentos), 3 (tudo) ou 4 (cancelar)." };
      const claimed = await claimPending(tx, userId, row.id, "done", now);
      if (!claimed) return { text: "Isso já foi processado." };
      return proposeDeleteAll(tx, userId, scopes[idx], payload.range ?? null, now, true);
    }

    if (payload.kind === "choose_target") {
      const idx = typeof decision === "number" ? decision - 1 : -1;
      if (idx < 0 || idx >= payload.candidates.length) return { text: `Escolha um número de 1 a ${payload.candidates.length}.` };
      const claimed = await claimPending(tx, userId, row.id, "done", now);
      if (!claimed) return { text: "Isso já foi processado." };
      let t: Transaction;
      try {
        t = await getTransaction(tx, userId, payload.candidates[idx].id);
      } catch {
        return { text: "Esse lançamento não existe mais." };
      }
      if (payload.next === "delete") return proposeDelete(tx, userId, t, now);
      return proposeUpdate(tx, userId, t, payload.patch ?? {}, now);
    }

    if (typeof decision === "number") return { text: "Responda com ✅ Confirmar ou ❌ Cancelar." };

    if (payload.kind === "complete_entry") return { text: payload.question };

    // Reivindica antes de executar: confirmação duplicada não executa duas vezes
    const claimed = await claimPending(tx, userId, row.id, "done", now);
    if (!claimed) return { text: "Isso já foi feito. ✅" };

    try {
      if (payload.kind === "confirm_create") {
        return await createAndReply(tx, userId, payload.entries, today);
      }
      if (payload.kind === "confirm_update") {
        const after = await updateEntry(tx, userId, payload.txId, payload.patch, "agent", { expectedVersion: payload.version, reason: `whatsapp:${msg.messageId}` });
        return { text: `✅ Lançamento corrigido!\n\n${fmt.describeTx(after)}\n\nOs totais e relatórios já foram atualizados.` };
      }
      if (payload.kind === "confirm_delete_all") {
        const scope = payload.scope ?? null;
        const n = await deleteAllEntries(tx, userId, "agent", scope, payload.range ?? null);
        if (scope !== "income") await tx.delete(budgetAlerts).where(eq(budgetAlerts.userId, userId));
        const what = scope === "expense" ? plural(n, "gasto", "gastos") : scope === "income" ? plural(n, "recebimento", "recebimentos") : plural(n, "lançamento", "lançamentos");
        return {
          text: scope || payload.range
            ? `🗑️ Pronto! Apaguei ${what}${payload.range ? ` (${payload.range.label})` : ""}.\n\nOs totais e relatórios já foram atualizados.`
            : `🗑️ Pronto! Apaguei ${what}.\n\nSua conta está zerada e pronta para começar de novo. É só me mandar o próximo gasto. 🙂`,
        };
      }
      if (payload.kind === "confirm_delete") {
        const removed = await deleteEntry(tx, userId, payload.txId, "agent", { wholeInstallmentGroup: payload.wholeGroup, expectedVersion: payload.version, reason: `whatsapp:${msg.messageId}` });
        const total = removed.filter((r) => r.kind !== "refund").reduce((s, r) => s + r.amountCents, 0);
        return { text: `🗑️ Lançamento excluído${removed.length > 1 ? ` (${removed.length} registros)` : ""}: ${formatBRL(total)}.\n\nOs totais e relatórios já foram atualizados.` };
      }
    } catch (err) {
      if (err instanceof FinanceError) return { text: err.userMessage };
      throw err;
    }
    return { text: "Não consegui concluir essa ação." };
  });
}

/** Usado pelo worker para saber se já existe lançamento desta mensagem (diagnóstico). */
export async function countEntriesFromMessage(userId: string, messageId: string) {
  return withUser(userId, async (tx) => {
    const [r] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), sql`${transactions.sourceMessageId} like ${messageId + "%"}`));
    return r.c;
  });
}
