import { z } from "zod";

/**
 * Contrato entre a IA e o backend. A IA só INTERPRETA a mensagem e devolve este
 * objeto; ela não tem acesso ao banco, não calcula totais e não executa nada.
 * O backend valida tudo (Zod) e decide o que fazer.
 */

export const QUERY_TYPES = [
  "summary", // resultado do período (receitas, despesas, saldo do período)
  "expenses_total",
  "income_total",
  "by_category", // despesas por categoria
  "category_total", // total de uma categoria
  "by_merchant", // gastos por estabelecimento (ou um estabelecimento: search)
  "by_client", // receitas por cliente/pagador (ou um cliente: search)
  "largest_expense",
  "largest_income",
  "recent", // últimos lançamentos
  "balance", // quanto tenho disponível / saldo das contas
  "payables", // contas a pagar / vencendo
  "recurring", // despesas recorrentes
  "evolution", // evolução nos últimos meses
] as const;

export const PERIOD_TYPES = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "month", "this_year", "last_n_days", "custom"] as const;
export const PAYMENT_METHODS = ["pix", "dinheiro", "debito", "credito", "boleto", "transferencia"] as const;
export const REFERENCE_TYPES = ["last", "last_expense", "last_income", "match", "duplicate"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const entrySchema = z.object({
  kind: z.enum(["income", "expense"]),
  amount: z.number().positive().max(20_000_000).nullable(), // em reais
  description: z.string().max(200),
  merchant: z.string().max(120).nullable(),
  counterparty: z.string().max(120).nullable(),
  category: z.string().max(48).nullable(), // slug
  date: isoDate.nullable(),
  payment_method: z.enum(PAYMENT_METHODS).nullable(),
  installments: z.number().int().min(2).max(72).nullable(),
  account_hint: z.string().max(60).nullable(),
});

export const periodSchema = z.object({
  type: z.enum(PERIOD_TYPES),
  month: z.number().int().min(1).max(12).nullable(),
  year: z.number().int().min(2000).max(2100).nullable(),
  days: z.number().int().min(1).max(366).nullable(),
  from: isoDate.nullable(),
  to: isoDate.nullable(),
});

export const querySchema = z.object({
  type: z.enum(QUERY_TYPES),
  period: periodSchema.nullable(),
  category: z.string().max(48).nullable(),
  search: z.string().max(80).nullable(),
  limit: z.number().int().min(1).max(30).nullable(),
});

export const targetSchema = z.object({
  reference: z.enum(REFERENCE_TYPES),
  kind: z.enum(["income", "expense"]).nullable(),
  amount: z.number().positive().nullable(),
  description: z.string().max(120).nullable(),
  date: isoDate.nullable(),
});

export const changesSchema = z.object({
  amount: z.number().positive().max(20_000_000).nullable(),
  description: z.string().max(200).nullable(),
  merchant: z.string().max(120).nullable(),
  counterparty: z.string().max(120).nullable(),
  category: z.string().max(48).nullable(),
  date: isoDate.nullable(),
  kind: z.enum(["income", "expense"]).nullable(),
  payment_method: z.enum(PAYMENT_METHODS).nullable(),
});

export const budgetSchema = z.object({
  action: z.enum(["set", "remove", "status"]),
  category: z.string().max(48).nullable(), // slug de despesa; null = limite total do mês
  amount: z.number().positive().max(20_000_000).nullable(), // em reais (só em "set")
});

export const fixedSchema = z.object({
  action: z.enum(["set", "remove", "list"]),
  kind: z.enum(["income", "expense"]),
  description: z.string().max(120).nullable(),
  amount: z.number().positive().max(20_000_000).nullable(), // em reais
  day: z.number().int().min(1).max(31).nullable(), // dia do vencimento
  category: z.string().max(48).nullable(),
});

export const interpretationSchema = z.object({
  intent: z.enum(["record", "query", "correct", "delete", "budget", "fixed", "confirm", "cancel", "select_option", "help", "greeting", "out_of_scope", "unclear"]),
  entries: z.array(entrySchema).max(5),
  query: querySchema.nullable(),
  target: targetSchema.nullable(),
  changes: changesSchema.nullable(),
  budget: budgetSchema.nullable(),
  fixed: fixedSchema.nullable(),
  selected_option: z.number().int().min(1).max(10).nullable(),
  clarification: z.string().max(300).nullable(),
  confidence: z.number().min(0).max(1),
});

export type Interpretation = z.infer<typeof interpretationSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Query = z.infer<typeof querySchema>;
export type Target = z.infer<typeof targetSchema>;
export type Changes = z.infer<typeof changesSchema>;
export type BudgetCommand = z.infer<typeof budgetSchema>;
export type FixedCommand = z.infer<typeof fixedSchema>;

/* ------------------------------------------------------------------ */
/* JSON Schema equivalente para Structured Outputs (strict)             */
/* ------------------------------------------------------------------ */
const nullable = (t: object) => ({ anyOf: [t, { type: "null" }] });
const str = { type: "string" };
const num = { type: "number" };
const int = { type: "integer" };
const date = { type: "string", description: "Data no formato YYYY-MM-DD" };
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});

export const interpretationJsonSchema = obj({
  intent: { type: "string", enum: interpretationSchema.shape.intent.options },
  entries: {
    type: "array",
    items: obj({
      kind: { type: "string", enum: ["income", "expense"] },
      amount: nullable({ ...num, description: "Valor em reais. null se o usuário não informou" }),
      description: { ...str, description: "Descrição curta do lançamento" },
      merchant: nullable({ ...str, description: "Estabelecimento (despesas)" }),
      counterparty: nullable({ ...str, description: "Cliente ou pagador (receitas)" }),
      category: nullable({ ...str, description: "Slug de uma das categorias do usuário" }),
      date: nullable(date),
      payment_method: nullable({ type: "string", enum: [...PAYMENT_METHODS] }),
      installments: nullable({ ...int, description: "Número total de parcelas, se parcelado" }),
      account_hint: nullable({ ...str, description: "Nome da conta ou cartão citado" }),
    }),
  },
  query: nullable(
    obj({
      type: { type: "string", enum: [...QUERY_TYPES] },
      period: nullable(
        obj({
          type: { type: "string", enum: [...PERIOD_TYPES] },
          month: nullable(int),
          year: nullable(int),
          days: nullable(int),
          from: nullable(date),
          to: nullable(date),
        }),
      ),
      category: nullable(str),
      search: nullable({ ...str, description: "Nome de estabelecimento, cliente ou termo citado" }),
      limit: nullable(int),
    }),
  ),
  target: nullable(
    obj({
      reference: { type: "string", enum: [...REFERENCE_TYPES] },
      kind: nullable({ type: "string", enum: ["income", "expense"] }),
      amount: nullable(num),
      description: nullable(str),
      date: nullable(date),
    }),
  ),
  changes: nullable(
    obj({
      amount: nullable(num),
      description: nullable(str),
      merchant: nullable(str),
      counterparty: nullable(str),
      category: nullable(str),
      date: nullable(date),
      kind: nullable({ type: "string", enum: ["income", "expense"] }),
      payment_method: nullable({ type: "string", enum: [...PAYMENT_METHODS] }),
    }),
  ),
  budget: nullable(
    obj({
      action: { type: "string", enum: ["set", "remove", "status"] },
      category: nullable({ ...str, description: "Slug de categoria de DESPESA; null = limite total do mês" }),
      amount: nullable({ ...num, description: "Valor do limite em reais (só para set)" }),
    }),
  ),
  fixed: nullable(
    obj({
      action: { type: "string", enum: ["set", "remove", "list"] },
      kind: { type: "string", enum: ["income", "expense"] },
      description: nullable({ ...str, description: "Nome da conta fixa, ex.: Aluguel" }),
      amount: nullable({ ...num, description: "Valor mensal em reais" }),
      day: nullable({ ...int, description: "Dia do mês do vencimento (1 a 31)" }),
      category: nullable({ ...str, description: "Slug de categoria do tipo certo" }),
    }),
  ),
  selected_option: nullable(int),
  clarification: nullable({ ...str, description: "Pergunta curta ao usuário quando faltar informação" }),
  confidence: { ...num, description: "0 a 1" },
});

export function emptyInterpretation(intent: Interpretation["intent"], extra: Partial<Interpretation> = {}): Interpretation {
  return { intent, entries: [], query: null, target: null, changes: null, budget: null, fixed: null, selected_option: null, clarification: null, confidence: 1, ...extra };
}
