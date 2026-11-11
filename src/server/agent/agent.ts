import { and, desc, eq, gt, sql } from "drizzle-orm";
import { withUser, type Tx } from "../db/client";
import { conversationTurns, pendingActions, transactions, users, type Category, type Transaction } from "../db/schema";
import {
  createEntry,
  deleteEntry,
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
  totalsByParty,
} from "../finance/queries";
import { addDays, addMonths, formatBR, isISODate, resolvePeriod, todayIn, type ISODate, type PeriodSpec } from "../finance/dates";
import { formatBRL, reaisToCents } from "../finance/money";
import { guessCategorySlug } from "../finance/categories";
import { FinanceError } from "../finance/errors";
import { normalize, interpretByRules, isTrivialMessage } from "./fallback";
import { AIError, type InterpretContext, type Interpreter } from "./llm";
import type { Changes, Entry, Interpretation, Query, Target } from "./schema";
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
type PendingPayload =
  | { kind: "confirm_create"; entries: CreateEntryInput[]; question: string }
  | { kind: "complete_entry"; entry: Entry; sourceMessageId: string; question: string }
  | { kind: "confirm_update"; txId: string; version: number; patch: EntryPatch; question: string }
  | { kind: "confirm_delete"; txId: string; version: number; wholeGroup: boolean; question: string }
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

async function recordEntries(userId: string, entries: Entry[], messageId: string, today: ISODate, now: Date, confidence: number): Promise<Reply> {
  // Faltou valor? Pergunta antes de registrar qualquer coisa.
  const missing = entries.find((e) => e.amount === null);
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
        description: e.description?.trim() || (e.kind === "expense" ? "Despesa" : "Receita"),
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
  if (results.length === 1) {
    const r = results[0];
    return fmt.recordedReply(r.rows, r.category, { merchant: r.input.merchant, counterparty: r.input.counterparty });
  }
  return fmt.multiRecordedReply(results);
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
      case "expenses_total": {
        const s = await periodSummary(tx, userId, period);
        const count = (await listTransactions(tx, userId, { period, kind: "expense", status: "paid", limit: 500 })).length;
        return fmt.totalReply("expense", period.label, s.netExpenseCents, count);
      }
      case "income_total": {
        const s = await periodSummary(tx, userId, period);
        const count = (await listTransactions(tx, userId, { period, kind: "income", status: "paid", limit: 500 })).length;
        return fmt.totalReply("income", period.label, s.incomeCents, count);
      }
      case "by_category":
        return fmt.categoriesReply(period.label, "expense", await totalsByCategory(tx, userId, period, "expense"));
      case "category_total": {
        if (!q.category) return fmt.categoriesReply(period.label, "expense", await totalsByCategory(tx, userId, period, "expense"));
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
        return fmt.recentReply(await listTransactions(tx, userId, { limit: q.limit ?? 10, kind }));
      }
      case "balance":
        return fmt.availabilityReply(await availability(tx, userId, today));
      case "payables":
        return fmt.payablesReply(await payables(tx, userId, addDays(today, 30)), today);
      case "recurring": {
        const rules = await listRecurring(tx, userId);
        if (!rules.length) return { text: "Você ainda não tem despesas recorrentes cadastradas. Dá para cadastrar no painel web." };
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

async function prepareDeletion(userId: string, target: Target | null, today: ISODate, now: Date): Promise<Reply> {
  return withUser(userId, async (tx) => {
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
