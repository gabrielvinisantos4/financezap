import { addDays, make, daysInMonth, type ISODate } from "../finance/dates";
import { DEFAULT_EXPENSE_CATEGORIES, guessCategorySlug } from "../finance/categories";
import { emptyInterpretation, type Entry, type Interpretation, type Query } from "./schema";
import type { InterpretContext, InterpretResult, Interpreter } from "./llm";

/**
 * Interpretador determinístico por regras. Usado quando a IA não está configurada
 * ou falha, e para respostas simples (sim/não/opção) sem gastar chamada de IA.
 * Cobre as frases mais comuns; o que não reconhece vira `unclear`.
 */

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const AMOUNT_RE = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(mil|k)?\b/;

export function extractAmount(text: string): number | null {
  const n = normalize(text);
  // "mil reais" sem número
  if (/(^|\s)(um\s+)?mil\s+(reais|real|conto|pila)/.test(n) && !/\d\s*mil/.test(n)) return 1000;
  const m = n.match(AMOUNT_RE);
  if (!m) return null;
  let raw = m[1];
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  let v = Number(raw);
  if (m[2]) v *= 1000;
  return Number.isFinite(v) && v > 0 ? v : null;
}

function extractDate(n: string, today: ISODate): ISODate | null {
  if (/\banteontem\b/.test(n)) return addDays(today, -2);
  if (/\bontem\b/.test(n)) return addDays(today, -1);
  if (/\bhoje\b/.test(n)) return today;
  const dm = n.match(/\bdia (\d{1,2})(?:\/(\d{1,2}))?\b/) ?? n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const [ty, tm] = today.split("-").map(Number);
    const d = Number(dm[1]);
    let m = dm[2] ? Number(dm[2]) : tm;
    let y = ty;
    if (m < 1 || m > 12) return null;
    if (!dm[2] && d > Number(today.slice(8))) {
      m = tm - 1 || 12;
      if (m === 12) y -= 1;
    } else if (dm[2] && make(y, m, 1) > today) {
      y -= 1;
    }
    if (d < 1 || d > daysInMonth(y, m)) return null;
    return make(y, m, d);
  }
  return null;
}

export function extractPaymentMethod(n: string): Entry["payment_method"] {
  if (/\bpix\b/.test(n)) return "pix";
  if (/\bdebito\b/.test(n)) return "debito";
  if (/\b(credito|cartao|cartoes|parcelad[oa])\b/.test(n)) return "credito";
  if (/\b(dinheiro|especie|em maos|cash)\b/.test(n)) return "dinheiro";
  if (/\bboleto\b/.test(n)) return "boleto";
  if (/\b(transferencia|ted|doc)\b/.test(n)) return "transferencia";
  return null;
}

function extractInstallments(n: string): number | null {
  const m = n.match(/\b(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)\b/);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 2 && v <= 72 ? v : null;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Texto após "no/na/em/de" que não seja número/valor. */
function extractPlace(original: string, preps: string[]): string | null {
  const re = new RegExp(`\\b(?:${preps.join("|")})\\s+([\\p{L}][\\p{L}\\s'&.-]{1,40}?)(?=\\s+(?:no|na|em|com|pelo|pela|via|hoje|ontem|anteontem|dia|parcelad\\w*|de\\s+\\d|por\\s+\\d|\\d)|[,.!?]|$)`, "iu");
  const m = original.match(re);
  if (!m) return null;
  const v = m[1].trim().replace(/\s+(reais|real)$/i, "");
  if (!v || /^(reais|real|cartao|cartão|credito|crédito|debito|débito|pix|dinheiro)$/i.test(v)) return null;
  return v;
}

const EXPENSE_VERBS = /\b(gastei|paguei|comprei|torrei|abasteci|gasto de|despesa de|saiu|pago|pagamos|gastamos)\b/;
const INCOME_VERBS = /\b(recebi|entrou|ganhei|vendi|caiu|faturei|recebemos|receita de)\b/;

/** "1.000 no cartão, 50 no pix" → um lançamento por valor, cada um com a sua forma de pagamento. */
function parseByPaymentMethod(original: string, n: string, today: ISODate): Interpretation | null {
  if (INCOME_VERBS.test(n)) return null;
  const parts = original.split(/\s*(?:,|;|\be\b|\+)\s*(?=(?:r\$\s*)?\d)/i).filter((p) => p.trim());
  const entries: Entry[] = [];
  for (const part of parts) {
    const pn = normalize(part);
    const amount = extractAmount(part);
    const method = extractPaymentMethod(pn);
    if (!amount || !method) return null;
    entries.push({
      kind: "expense",
      amount,
      description: DEFAULT_DESCRIPTION[method],
      merchant: null,
      counterparty: null,
      category: "outros",
      date: extractDate(n, today),
      payment_method: method,
      installments: extractInstallments(pn),
      account_hint: null,
    });
  }
  if (!entries.length || entries.length > 5) return null;
  return emptyInterpretation("record", { entries, confidence: 0.75 });
}

const DEFAULT_DESCRIPTION: Record<NonNullable<Entry["payment_method"]>, string> = {
  credito: "Compra no cartão",
  debito: "Compra no débito",
  pix: "Pagamento no Pix",
  dinheiro: "Pagamento em dinheiro",
  boleto: "Pagamento de boleto",
  transferencia: "Transferência",
};

function parseRecord(original: string, n: string, today: ISODate): Interpretation | null {
  const isIncome = INCOME_VERBS.test(n);
  const isExpense = EXPENSE_VERBS.test(n);
  if (!isIncome && !isExpense) return parseByPaymentMethod(original, n, today);
  // "gastei 1.000 no cartão e 50 no pix": vários valores, cada um com a sua forma
  if (!isIncome) {
    const rest = original.replace(/^\s*\S+\s+/, "");
    const multi = parseByPaymentMethod(rest, normalize(rest), today);
    if (multi && multi.entries.length > 1) return multi;
  }
  const kind: "income" | "expense" = isIncome && !isExpense ? "income" : "expense";
  const amount = extractAmount(original);
  const category = guessCategorySlug(original, kind);

  let merchant: string | null = null;
  let counterparty: string | null = null;
  let description: string;
  if (kind === "expense") {
    merchant = extractPlace(original, ["no", "na", "em", "com o", "com a"]);
    const subject = extractPlace(original, ["de", "com"]);
    description = capitalize(merchant ?? subject ?? (category === "outros" ? "Despesa" : category.replace(/-/g, " ")));
  } else {
    counterparty = extractPlace(original, ["de um", "de uma", "do", "da", "de"]);
    const por = extractPlace(original, ["por um", "por uma", "por", "pelo", "pela"]);
    description = capitalize(por ?? counterparty ?? "Receita");
  }

  const entry: Entry = {
    kind,
    amount,
    description,
    merchant,
    counterparty,
    category,
    date: extractDate(n, today),
    payment_method: extractPaymentMethod(n),
    installments: extractInstallments(n),
    account_hint: null,
  };
  return emptyInterpretation("record", {
    entries: [entry],
    clarification: amount ? null : kind === "expense" ? "Qual foi o valor dessa despesa?" : "Qual foi o valor recebido?",
    confidence: amount ? 0.8 : 0.5,
  });
}

function parsePeriod(n: string): Query["period"] {
  const base = { month: null, year: null, days: null, from: null, to: null };
  if (/\bhoje\b/.test(n)) return { ...base, type: "today" };
  if (/\bontem\b/.test(n)) return { ...base, type: "yesterday" };
  if (/semana passada/.test(n)) return { ...base, type: "last_week" };
  if (/\b(nesta|esta|essa|nessa) semana\b|\bna semana\b/.test(n)) return { ...base, type: "this_week" };
  if (/mes passado/.test(n)) return { ...base, type: "last_month" };
  const days = n.match(/ultimos (\d{1,3}) dias/);
  if (days) return { ...base, type: "last_n_days", days: Number(days[1]) };
  if (/\b(este|esse|neste|nesse) ano\b/.test(n)) return { ...base, type: "this_year" };
  for (const [name, num] of Object.entries(MONTHS)) {
    const m = n.match(new RegExp(`\\b${name}(?:\\s+(?:de\\s+)?(\\d{4}))?\\b`));
    if (m) return { ...base, type: "month", month: num, year: m[1] ? Number(m[1]) : null };
  }
  return { ...base, type: "this_month" };
}

function parseQuery(original: string, n: string): Interpretation | null {
  const looksLikeQuestion = /^(quanto|quantos|qual|quais|mostra|me mostra|mostre|lista|listar|saldo|extrato|resumo|como (foi|esta|estao|ta)|o que|tenho|minhas?|meus?)\b/.test(n) || n.endsWith("?");
  if (!looksLikeQuestion) return null;
  const q = (type: Query["type"], extra: Partial<Query> = {}): Interpretation =>
    emptyInterpretation("query", { query: { type, period: null, category: null, search: null, limit: null, ...extra }, confidence: 0.75 });

  if (/(disponivel|saldo|quanto tenho|tenho na conta|tenho em conta)/.test(n)) return q("balance");
  if (/(contas? a pagar|vence|vencem|vencendo|a vencer|boletos?)/.test(n)) return q("payables");
  if (/recorrente/.test(n)) return q("recurring");
  const evo = n.match(/(evolucao|ultimos (\d{1,2}) meses)/);
  if (evo) return q("evolution", { limit: evo[2] ? Number(evo[2]) : 6 });
  const WORD_NUM: Record<string, number> = { tres: 3, cinco: 5, dez: 10, quinze: 15, vinte: 20 };
  const recent = n.match(/ultim[oa]s?\s*(\d{1,2}|tres|cinco|dez|quinze|vinte)?\s*(lancamentos|movimentacoes|registros|gastos|despesas|receitas)|extrato/);
  if (recent) {
    const word = recent[2] ?? "";
    const limit = recent[1] ? (WORD_NUM[recent[1]] ?? Number(recent[1])) : 10;
    return q("recent", { limit, search: null, category: /gastos|despesas/.test(word) ? "expense" : /receitas/.test(word) ? "income" : null });
  }
  const period = parsePeriod(n);
  if (/(cada|por) forma de pagamento|formas? de pagamento|cartao e (quanto )?(no )?pix|pix e (quanto )?(no )?cartao/.test(n)) return q("by_payment_method", { period });
  const method = extractPaymentMethod(n);
  if (method && !/\b(saldo|disponivel)\b/.test(n)) {
    if (/(entrou|recebi|receitas?|ganhei|faturei|entrada)/.test(n)) return q("income_total", { period, payment_method: method });
    if (/(gastei|gasto|gastos|despesas?|paguei|saiu|saida|comprei)/.test(n)) return q("expenses_total", { period, payment_method: method });
  }
  if (/maior (despesa|gasto|compra)/.test(n)) return q("largest_expense", { period });
  if (/maior (receita|entrada|recebimento)/.test(n)) return q("largest_income", { period });
  if (/(cada|por) cliente|de quem (recebi|entrou)/.test(n)) return q("by_client", { period });
  if (/(cada|por) categoria|onde (mais )?gastei|com o que (mais )?gastei/.test(n)) return q("by_category", { period });
  if (/(cada|por) (estabelecimento|lugar|loja)/.test(n)) return q("by_merchant", { period });

  const recebiDe = original.match(/(?:recebi|entrou)\s+d[oae]\s+(?:cliente\s+)?([\p{L}][\p{L}\s'&.-]{1,40}?)(?=\s+(?:em|no|na|este|esse|neste|nesse|hoje|ontem|ess|est)|[?.!,]|$)/iu);
  if (recebiDe) return q("by_client", { period, search: recebiDe[1].trim() });

  const isExpenseQ = /(gastei|gasto|gastos|despesas?|paguei|saiu|saida)/.test(n);
  const isIncomeQ = /(entrou|recebi|receitas?|ganhei|faturei|entrada)/.test(n);
  if (isExpenseQ && !isIncomeQ) {
    const com = original.match(/(?:com|de|em|no|na)\s+([\p{L}][\p{L}\s]{2,30}?)(?=\s+(?:em|neste|nesse|este|esse|hoje|ontem|no mes|na semana|semana|mes|janeiro|fevereiro|mar|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|[?.!,]|$)/iu);
    if (com) {
      const term = com[1].trim();
      const slug = guessCategorySlug(term, "expense");
      if (slug !== "outros") return q("category_total", { period, category: slug });
      if (!/^(hoje|ontem|mes|semana|ano)$/i.test(term)) return q("by_merchant", { period, search: term });
    }
    return q("expenses_total", { period });
  }
  if (isIncomeQ && !isExpenseQ) return q("income_total", { period });
  if (/(resultado|resumo|sobrou|lucro|balanco|como foi|como esta)/.test(n)) return q("summary", { period });
  return null;
}

function parseCorrection(original: string, n: string): Interpretation | null {
  if (!/(errei|corrig|corrij|na verdade|nao foi|foi errado|valor certo|era (de )?r?\$?\s*\d|muda o valor|altera|troca a categoria)/.test(n)) return null;
  const kind: "income" | "expense" | null = /receita|recebi|entrada/.test(n) ? "income" : /gasto|despesa/.test(n) ? "expense" : null;
  const changes = { amount: null as number | null, description: null, merchant: null as string | null, counterparty: null, category: null as string | null, date: null, kind: null, payment_method: null };
  const valueMatch = original.match(/(?:era|eram|foi de|para|pra|valor (?:certo|correto) (?:e|é)?)\s*(?:de\s+)?(r\$\s*)?(\d[\d.,]*\s*(?:mil|k)?)/i);
  if (valueMatch) changes.amount = extractAmount(valueMatch[2]);
  const placeMatch = original.match(/n[aã]o foi n[oa] .+?,?\s*foi n[oa]\s+([\p{L}][\p{L}\s]{1,40}?)(?=[.!?,]|$)/iu);
  if (placeMatch) {
    const place = placeMatch[1].trim();
    changes.merchant = place;
    const slug = guessCategorySlug(place, kind ?? "expense");
    if (slug !== "outros") changes.category = slug;
  }
  if (!changes.amount && !changes.merchant) {
    return emptyInterpretation("correct", {
      target: { reference: kind === "income" ? "last_income" : kind === "expense" ? "last_expense" : "last", kind, amount: null, description: null, date: null },
      clarification: "O que você quer corrigir? Me diga o valor ou a informação certa.",
      confidence: 0.4,
    });
  }
  return emptyInterpretation("correct", {
    target: { reference: kind === "income" ? "last_income" : kind === "expense" ? "last_expense" : "last", kind, amount: null, description: null, date: null },
    changes,
    confidence: 0.75,
  });
}

function parseDelete(original: string, n: string): Interpretation | null {
  if (/(duas vezes|duplicad|repetid|em dobro)/.test(n) && /(registrei|lancei|anotei|ficou|esta|tem)/.test(n)) {
    return emptyInterpretation("delete", { target: { reference: "duplicate", kind: null, amount: null, description: null, date: null }, confidence: 0.8 });
  }
  // "apaga todos os meus lançamentos", "zera tudo", "limpa todos os registros"
  if (
    /\b(apaga|apague|apagar|exclui|exclua|excluir|deleta|delete|remove|remova|remover|limpa|limpe|limpar|zera|zere|zerar|cancela|cancele|cancelar)\b/.test(n) &&
    (/\b(todos|todas)\b.*\b(lancamentos|gastos|registros|despesas|movimentacoes|dados|recebimentos|receitas|entradas|ganhos)\b/.test(n) || /\b(zera|zere|zerar|limpa|limpe|limpar|apaga|apagar|cancela|cancelar) (tudo|meus lancamentos|os lancamentos)\b/.test(n))
  ) {
    const scope: "income" | "expense" | null = /\b(todos|todas) (os |as )?(meus |minhas )?(gastos|despesas)\b/.test(n)
      ? "expense"
      : /\b(todos|todas) (os |as )?(meus |minhas )?(recebimentos|receitas|entradas|ganhos)\b/.test(n)
        ? "income"
        : null;
    const hasPeriod = /\b(hoje|ontem|semana|mes|ano|dias|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(n);
    return emptyInterpretation("delete", { target: { reference: "all", kind: scope, amount: null, description: null, date: null, period: hasPeriod ? parsePeriod(n) : null }, confidence: 0.85 });
  }
  if (!/\b(apaga|apague|apagar|exclui|exclua|excluir|deleta|delete|remove|remova|remover|desfaz|desfazer)\b/.test(n)) return null;
  const kind: "income" | "expense" | null = /(receita|entrada|recebimento)/.test(n) ? "income" : /(gasto|despesa|compra)/.test(n) ? "expense" : null;
  const amount = /\d/.test(n) ? extractAmount(original) : null;
  const isLast = /ultim[oa]|esse|isso|desfaz/.test(n);
  const reference = amount && !isLast ? "match" : kind === "income" ? "last_income" : kind === "expense" ? "last_expense" : "last";
  return emptyInterpretation("delete", { target: { reference, kind, amount, description: null, date: null }, confidence: 0.8 });
}

export function interpretByRules(message: string, ctx: Pick<InterpretContext, "today">): Interpretation {
  const original = message.trim();
  const n = normalize(original);
  if (!n) return emptyInterpretation("unclear", { confidence: 0 });

  if (/^(sim|s|pode|pode sim|confirmo|confirmar|confirma|ok|isso|isso mesmo|certo|claro|beleza|blz|positivo)[.!]*$/.test(n)) return emptyInterpretation("confirm");
  if (/^(nao|n|cancela|cancelar|cancele|deixa|deixa pra la|esquece|negativo)[.!]*$/.test(n)) return emptyInterpretation("cancel");
  const opt = n.match(/^(?:opcao\s*|a\s+|o\s+|numero\s*)?(\d)(?:a|o)?[.!]*$/);
  if (opt) return emptyInterpretation("select_option", { selected_option: Number(opt[1]) });
  if (/^(oi|ola|bom dia|boa tarde|boa noite|e ai|hey|opa|salve)\b/.test(n) && n.length < 25) return emptyInterpretation("greeting");
  if (/(ajuda|como funciona|como (eu )?uso|o que (voce )?(faz|sabe)|comandos|menu)/.test(n)) return emptyInterpretation("help");

  return (
    parseFixed(original, n) ??
    parseBudget(original, n) ??
    parseDelete(original, n) ??
    parseCorrection(original, n) ??
    parseQuery(original, n) ??
    parseRecord(original, n, ctx.today) ??
    emptyInterpretation("unclear", { confidence: 0 })
  );
}

/** Categoria de despesa citada num pedido de limite (pelo nome da categoria ou por palavra-chave). */
function budgetCategory(n: string): string | null {
  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    if (c.slug === "outros") continue;
    const names = [normalize(c.name), c.slug.replace(/-/g, " ")];
    if (names.some((x) => new RegExp(`\\b${x}\\b`).test(n))) return c.slug;
  }
  const g = guessCategorySlug(n, "expense");
  return g === "outros" ? null : g;
}

function parseFixed(original: string, n: string): Interpretation | null {
  const mentions = /\b(conta fixa|contas fixas|gasto fixo|gastos fixos|despesa fixa|despesas fixas|receita fixa|receitas fixas|entrada fixa|entradas fixas|ganho fixo|ganhos fixos|todo mes|todos os meses|mensalmente|todo dia \d{1,2}|recorrente)\b/.test(n);
  if (!mentions) return null;
  const kind: "income" | "expense" = /\b(recebo|ganho|ganhos|salario|entra|receita|receitas|entrada|entradas)\b/.test(n) ? "income" : "expense";
  const fixed = (action: "set" | "remove" | "list", extra: Partial<{ description: string | null; amount: number | null; day: number | null; category: string | null }> = {}): Interpretation =>
    emptyInterpretation("fixed", { fixed: { action, kind, description: null, amount: null, day: null, category: null, ...extra }, confidence: 0.75 });
  if (/^(quais|qual|lista|listar|mostra|me mostra|minhas?)\b/.test(n) || n.endsWith("?")) return fixed("list");
  const category = guessCategorySlug(original, kind);
  const label = DEFAULT_EXPENSE_CATEGORIES.concat().find((c) => c.slug === category);
  const word = n.match(/\b(aluguel|condominio|internet|luz|energia|agua|gas|celular|telefone|academia|escola|faculdade|plano de saude|netflix|spotify|financiamento|consorcio|salario|mensalidade|seguro)\b/)?.[1] ?? null;
  // "800 de social media todo dia 10" → "Social media"
  const named = n
    .match(/\d[\d.,]*\s*(?:mil\s+)?(?:reais\s+)?(?:de|do|da|com)\s+(?:o\s+|a\s+|um\s+|uma\s+)?(?:cliente\s+(?:de\s+)?)?([a-z][a-z ]{2,30}?)(?=\s+(?:todo|toda|todos|no dia|dia|por mes|mensal|,|$)|$)/)?.[1]
    ?.trim() ?? n.match(/\bcliente (?:de|do|da) ([a-z][a-z ]{2,30}?)(?=\s+(?:no dia|dia|todo|toda|por mes)|$)/)?.[1]?.trim();
  const description = word ? capitalize(word) : named && !/^(mes|todo|cada)\b/.test(named) ? capitalize(named) : label && label.slug !== "outros" ? label.name : null;
  if (/\b(tira|tirar|remove|remover|apaga|apagar|exclui|excluir|cancela|cancelar|para de|parar)\b/.test(n)) return fixed("remove", { description, category });
  const day = Number(n.match(/\bdia (\d{1,2})\b/)?.[1] ?? NaN);
  const textNoDay = original.replace(/\bdia\s+\d{1,2}\b/gi, " ");
  return fixed("set", { description, amount: extractAmount(textNoDay), day: day >= 1 && day <= 31 ? day : null, category });
}

function parseBudget(original: string, n: string): Interpretation | null {
  if (!/\b(limite|limites|teto|orcamento)\b/.test(n)) return null;
  const budget = (action: "set" | "remove" | "status", amount: number | null = null): Interpretation =>
    emptyInterpretation("budget", { budget: { action, category: budgetCategory(n), amount }, confidence: 0.8 });
  if (/\b(tira|tirar|remove|remover|apaga|apagar|exclui|excluir|cancela|cancelar|sem)\b/.test(n)) return budget("remove");
  const amount = extractAmount(original);
  if (amount && !/\b(quanto|como|falta|restam?)\b/.test(n)) return budget("set", amount);
  return budget("status");
}

export class RuleInterpreter implements Interpreter {
  name = "rules";
  async interpret(message: string, ctx: InterpretContext): Promise<InterpretResult> {
    return { interpretation: interpretByRules(message, ctx), usage: null };
  }
}

/** Mensagens que não precisam de IA (economia de custo e latência). */
export function isTrivialMessage(message: string): boolean {
  const i = interpretByRules(message, { today: "2000-01-01" });
  return ["confirm", "cancel", "select_option", "greeting", "help"].includes(i.intent);
}
