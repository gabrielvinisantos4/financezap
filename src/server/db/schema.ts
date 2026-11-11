import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  foreignKey,
  check,
  unique,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ */
/* Enums                                                                */
/* ------------------------------------------------------------------ */
export const userRole = pgEnum("user_role", ["user", "support", "admin", "owner"]);
export const userStatus = pgEnum("user_status", ["active", "blocked", "deleted"]);
export const accountType = pgEnum("account_type", ["checking", "savings", "cash", "wallet", "investment", "credit_card"]);
export const categoryKind = pgEnum("category_kind", ["income", "expense"]);
export const txKind = pgEnum("tx_kind", ["income", "expense", "transfer", "card_payment", "refund"]);
export const txStatus = pgEnum("tx_status", ["paid", "pending"]);
export const txSource = pgEnum("tx_source", ["whatsapp", "web", "system"]);
export const historyAction = pgEnum("history_action", ["create", "update", "delete", "restore"]);
export const actorType = pgEnum("actor_type", ["user", "agent", "system", "admin"]);
export const billingCycle = pgEnum("billing_cycle", ["monthly", "yearly"]);
export const subscriptionStatus = pgEnum("subscription_status", ["pending", "active", "past_due", "canceled", "expired"]);
export const pendingActionStatus = pgEnum("pending_action_status", ["pending", "done", "canceled", "expired"]);
export const inboundStatus = pgEnum("inbound_status", ["queued", "processing", "processed", "ignored", "failed"]);
export const usageType = pgEnum("usage_type", ["ai_call", "wa_inbound", "wa_outbound"]);
export const dataRequestType = pgEnum("data_request_type", ["export", "delete"]);
export const dataRequestStatus = pgEnum("data_request_status", ["requested", "processing", "done", "rejected"]);
export const affiliateStatus = pgEnum("affiliate_status", ["active", "blocked"]);
export const commissionStatus = pgEnum("commission_status", ["credited", "reversed"]);

/* ------------------------------------------------------------------ */
/* Identidade, sessões e consentimentos                                 */
/* ------------------------------------------------------------------ */
export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    phoneE164: text("phone_e164"),
    role: userRole("role").notNull().default("user"),
    status: userStatus("status").notNull().default("active"),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    // Permissão explícita para ver dados pessoais no admin (além do papel)
    canViewPii: boolean("can_view_pii").notNull().default(false),
    blockedReason: text("blocked_reason"),
    // Afiliado que trouxe este cliente (link /r/<código>); sem FK para não criar ciclo com affiliates
    referredByAffiliateId: uuid("referred_by_affiliate_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), index("users_referred_by_idx").on(t.referredByAffiliateId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const consents = pgTable("consents", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // terms | privacy | whatsapp_messages
  version: text("version").notNull(),
  ip: text("ip"),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* WhatsApp                                                             */
/* ------------------------------------------------------------------ */
export const whatsappIdentities = pgTable(
  "whatsapp_identities",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    waId: text("wa_id").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("wa_identities_wa_uq").on(t.waId), uniqueIndex("wa_identities_user_uq").on(t.userId)],
);

export const linkCodes = pgTable(
  "link_codes",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("link_codes_hash_uq").on(t.codeHash)],
);

export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: id(),
    waMessageId: text("wa_message_id").notNull(),
    waId: text("wa_id").notNull(),
    userId: uuid("user_id"),
    type: text("type").notNull(),
    // Conteúdo mínimo necessário para processar; apagado pela rotina de retenção
    payload: jsonb("payload"),
    // Resposta já calculada: se o envio falhar, a nova tentativa só reenvia (não reexecuta a ação)
    reply: jsonb("reply"),
    status: inboundStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    receivedAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("inbound_wa_msg_uq").on(t.waMessageId), index("inbound_status_idx").on(t.status)],
);

export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: id(),
    userId: uuid("user_id"),
    waId: text("wa_id").notNull(),
    waMessageId: text("wa_message_id"),
    kind: text("kind").notNull(), // text | buttons | template
    status: text("status").notNull().default("sent"), // sent | delivered | read | failed | dry_run
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("outbound_wa_msg_idx").on(t.waMessageId)],
);

/* ------------------------------------------------------------------ */
/* Planos e assinaturas                                                 */
/* ------------------------------------------------------------------ */
export type PlanLimits = {
  monthlyMessages: number; // mensagens processadas por mês
  monthlyAiCalls: number; // chamadas de IA por mês
  maxAccounts: number;
  customCategories: boolean;
  advancedReports: boolean;
};

export const plans = pgTable(
  "plans",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceMonthlyCents: integer("price_monthly_cents").notNull(),
    priceYearlyCents: integer("price_yearly_cents").notNull(),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    limits: jsonb("limits").$type<PlanLimits>().notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("plans_slug_uq").on(t.slug)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    cycle: billingCycle("cycle").notNull(),
    status: subscriptionStatus("status").notNull().default("pending"),
    priceCents: integer("price_cents").notNull(), // preço contratado (congelado)
    provider: text("provider").notNull().default("asaas"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerCheckoutId: text("provider_checkout_id"),
    paymentMethod: text("payment_method"), // pix | credit_card | manual
    // Afiliado que recebe o split desta assinatura (null = sem comissão)
    affiliateId: uuid("affiliate_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    graceUntil: timestamp("grace_until", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subscriptions_provider_uq").on(t.providerSubscriptionId),
    index("subscriptions_user_idx").on(t.userId),
    index("subscriptions_status_idx").on(t.status),
    index("subscriptions_customer_idx").on(t.providerCustomerId),
    uniqueIndex("subscriptions_checkout_uq").on(t.providerCheckoutId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    providerPaymentId: text("provider_payment_id").notNull(),
    status: text("status").notNull(),
    valueCents: integer("value_cents").notNull(),
    billingType: text("billing_type"),
    dueDate: date("due_date"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    invoiceUrl: text("invoice_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payments_provider_uq").on(t.providerPaymentId)],
);

export const billingEvents = pgTable(
  "billing_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("billing_events_uq").on(t.provider, t.providerEventId)],
);

/* ------------------------------------------------------------------ */
/* Programa de afiliados                                                */
/* ------------------------------------------------------------------ */
export const affiliates = pgTable(
  "affiliates",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(), // usado no link /r/<code>
    walletId: text("wallet_id"), // carteira do Asaas que recebe o split
    commissionBps: integer("commission_bps").notNull(), // 3000 = 30% do valor líquido
    status: affiliateStatus("status").notNull().default("active"),
    clicks: integer("clicks").notNull().default(0),
    blockedReason: text("blocked_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("affiliates_user_uq").on(t.userId), uniqueIndex("affiliates_code_uq").on(sql`lower(${t.code})`)],
);

export const affiliateCommissions = pgTable(
  "affiliate_commissions",
  {
    id: id(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id, { onDelete: "cascade" }),
    customerUserId: uuid("customer_user_id").references(() => users.id, { onDelete: "set null" }),
    providerPaymentId: text("provider_payment_id").notNull(),
    netCents: integer("net_cents").notNull(),
    commissionCents: integer("commission_cents").notNull(),
    status: commissionStatus("status").notNull().default("credited"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("affiliate_commissions_payment_uq").on(t.providerPaymentId), index("affiliate_commissions_affiliate_idx").on(t.affiliateId)],
);

/* ------------------------------------------------------------------ */
/* Dados financeiros (isolados por usuário com RLS)                     */
/* ------------------------------------------------------------------ */
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    initialBalanceCents: integer("initial_balance_cents").notNull().default(0),
    creditLimitCents: integer("credit_limit_cents"),
    closingDay: integer("closing_day"),
    dueDay: integer("due_day"),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("accounts_id_user_uq").on(t.id, t.userId),
    uniqueIndex("accounts_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    check("accounts_days_ck", sql`(closing_day is null or closing_day between 1 and 31) and (due_day is null or due_day between 1 and 31)`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: categoryKind("kind").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    icon: text("icon").notNull().default("•"),
    parentId: uuid("parent_id"),
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("categories_id_user_uq").on(t.id, t.userId),
    uniqueIndex("categories_user_kind_slug_uq").on(t.userId, t.kind, t.slug),
    foreignKey({ columns: [t.parentId, t.userId], foreignColumns: [t.id, t.userId], name: "categories_parent_fk" }),
  ],
);

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: txKind("kind").notNull(), // income | expense
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    categoryId: uuid("category_id"),
    accountId: uuid("account_id"),
    dayOfMonth: integer("day_of_month").notNull(),
    nextDueOn: date("next_due_on").notNull(),
    endOn: date("end_on"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("recurring_id_user_uq").on(t.id, t.userId),
    check("recurring_amount_ck", sql`amount_cents > 0`),
    check("recurring_day_ck", sql`day_of_month between 1 and 31`),
    foreignKey({ columns: [t.categoryId, t.userId], foreignColumns: [categories.id, categories.userId], name: "recurring_category_fk" }),
    foreignKey({ columns: [t.accountId, t.userId], foreignColumns: [accounts.id, accounts.userId], name: "recurring_account_fk" }),
  ],
);

/** Limite de gasto mensal: por categoria ou, com categoryId nulo, do total do mês. */
export const budgets = pgTable(
  "budgets",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id"),
    amountCents: integer("amount_cents").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("budgets_id_user_uq").on(t.id, t.userId),
    unique("budgets_user_category_uq").on(t.userId, t.categoryId).nullsNotDistinct(),
    check("budgets_amount_ck", sql`amount_cents > 0`),
    foreignKey({ columns: [t.categoryId, t.userId], foreignColumns: [categories.id, categories.userId], name: "budgets_category_fk" }).onDelete("cascade"),
  ],
);

/** Alertas já enviados (80% e 100%) por limite e mês, para não repetir o aviso. */
export const budgetAlerts = pgTable(
  "budget_alerts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    budgetId: uuid("budget_id").notNull(),
    periodStart: date("period_start").notNull(),
    threshold: integer("threshold").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("budget_alerts_uq").on(t.budgetId, t.periodStart, t.threshold),
    foreignKey({ columns: [t.budgetId, t.userId], foreignColumns: [budgets.id, budgets.userId], name: "budget_alerts_budget_fk" }).onDelete("cascade"),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: txKind("kind").notNull(),
    // Sempre positivo; o sentido vem de `kind`
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    merchant: text("merchant"), // estabelecimento (despesa)
    counterparty: text("counterparty"), // cliente/pagador (receita)
    categoryId: uuid("category_id"),
    accountId: uuid("account_id").notNull(),
    toAccountId: uuid("to_account_id"), // transferência / pagamento de fatura
    occurredOn: date("occurred_on").notNull(), // data de competência/compra
    dueOn: date("due_on"), // vencimento (contas a pagar)
    status: txStatus("status").notNull().default("paid"),
    paymentMethod: text("payment_method"), // pix | dinheiro | debito | credito | boleto | transferencia
    installmentGroupId: uuid("installment_group_id"),
    installmentNumber: integer("installment_number"),
    installmentTotal: integer("installment_total"),
    recurringRuleId: uuid("recurring_rule_id"),
    // Lembrete do dia do vencimento já enviado no WhatsApp (envia uma vez só)
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    refundOfId: uuid("refund_of_id"),
    notes: text("notes"),
    source: txSource("source").notNull().default("web"),
    sourceMessageId: text("source_message_id"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("transactions_id_user_uq").on(t.id, t.userId),
    index("tx_user_date_idx").on(t.userId, t.occurredOn),
    index("tx_user_kind_date_idx").on(t.userId, t.kind, t.occurredOn),
    index("tx_user_category_idx").on(t.userId, t.categoryId),
    index("tx_user_status_due_idx").on(t.userId, t.status, t.dueOn),
    index("tx_installment_group_idx").on(t.installmentGroupId),
    // Mesma mensagem do WhatsApp não gera dois lançamentos
    uniqueIndex("tx_source_message_uq")
      .on(t.userId, t.sourceMessageId, sql`coalesce(installment_number, 0)`)
      .where(sql`source_message_id is not null`),
    check("tx_amount_positive_ck", sql`amount_cents > 0`),
    check(
      "tx_transfer_target_ck",
      sql`(kind in ('transfer','card_payment')) = (to_account_id is not null)`,
    ),
    check("tx_transfer_distinct_ck", sql`to_account_id is null or to_account_id <> account_id`),
    check(
      "tx_installment_ck",
      sql`(installment_total is null and installment_number is null) or (installment_number between 1 and installment_total)`,
    ),
    foreignKey({ columns: [t.accountId, t.userId], foreignColumns: [accounts.id, accounts.userId], name: "tx_account_fk" }),
    foreignKey({ columns: [t.toAccountId, t.userId], foreignColumns: [accounts.id, accounts.userId], name: "tx_to_account_fk" }),
    foreignKey({ columns: [t.categoryId, t.userId], foreignColumns: [categories.id, categories.userId], name: "tx_category_fk" }),
    foreignKey({ columns: [t.refundOfId, t.userId], foreignColumns: [t.id, t.userId], name: "tx_refund_of_fk" }),
    foreignKey({ columns: [t.recurringRuleId, t.userId], foreignColumns: [recurringRules.id, recurringRules.userId], name: "tx_recurring_fk" }),
  ],
);

export const transactionHistory = pgTable(
  "transaction_history",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    action: historyAction("action").notNull(),
    actor: actorType("actor").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("tx_history_tx_idx").on(t.transactionId)],
);

/* ------------------------------------------------------------------ */
/* Agente: confirmações pendentes e contexto de conversa                */
/* ------------------------------------------------------------------ */
export const pendingActions = pgTable(
  "pending_actions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // update_tx | delete_tx | create_tx | choose_tx
    payload: jsonb("payload").notNull(),
    status: pendingActionStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("pending_user_status_idx").on(t.userId, t.status)],
);

export const conversationTurns = pgTable(
  "conversation_turns",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("turns_user_created_idx").on(t.userId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Uso, custos, operação e auditoria                                    */
/* ------------------------------------------------------------------ */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    userId: uuid("user_id"),
    type: usageType("type").notNull(),
    quantity: integer("quantity").notNull().default(1),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    // custo estimado em micro-dólares (1 USD = 1_000_000)
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_user_created_idx").on(t.userId, t.createdAt), index("usage_type_created_idx").on(t.type, t.createdAt)],
);

export const operationalEvents = pgTable(
  "operational_events",
  {
    id: id(),
    level: text("level").notNull(), // info | warn | error
    type: text("type").notNull(),
    message: text("message").notNull(),
    userId: uuid("user_id"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("op_events_created_idx").on(t.createdAt), index("op_events_level_idx").on(t.level, t.createdAt)],
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: id(),
    adminId: uuid("admin_id").notNull().references(() => users.id),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id"),
    reason: text("reason"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("admin_audit_created_idx").on(t.createdAt)],
);

export const dataRequests = pgTable("data_requests", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: dataRequestType("type").notNull(),
  status: dataRequestStatus("status").notNull().default("requested"),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type PendingAction = typeof pendingActions.$inferSelect;

export type Budget = typeof budgets.$inferSelect;

export type Affiliate = typeof affiliates.$inferSelect;
export type AffiliateCommission = typeof affiliateCommissions.$inferSelect;
