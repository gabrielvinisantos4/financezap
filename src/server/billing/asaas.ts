import { env } from "../config/env";

/**
 * Cliente mínimo da API v3 do Asaas.
 * Base: sandbox https://api-sandbox.asaas.com/v3 | produção https://api.asaas.com/v3
 * Autenticação: header `access_token`.
 */
export class AsaasError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
    this.name = "AsaasError";
  }
}

export type AsaasPayment = {
  id: string;
  customer: string;
  subscription?: string | null;
  status: string; // PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED, ...
  value: number;
  billingType?: string;
  dueDate?: string;
  paymentDate?: string | null;
  confirmedDate?: string | null;
  invoiceUrl?: string | null;
  externalReference?: string | null;
  netValue?: number | null;
  split?: { walletId: string; totalValue?: number | null; percentualValue?: number | null; status?: string }[] | null;
};

export type AsaasSplit = { walletId: string; percentualValue: number };

export type AsaasSubscription = { id: string; customer: string; status: string; value: number; cycle: string; nextDueDate: string; externalReference?: string | null; deleted?: boolean; split?: { walletId: string; percentualValue?: number | null }[] | null };

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
/** Só para testes. */
export function setAsaasFetcher(f: Fetcher | null) {
  fetcher = f ?? ((...a) => fetch(...a));
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const e = env();
  if (!e.ASAAS_API_KEY) throw new AsaasError("Asaas não configurado (ASAAS_API_KEY)", 0);
  const res = await fetcher(`${e.ASAAS_BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", access_token: e.ASAAS_API_KEY, "User-Agent": `${e.APP_NAME}/1.0` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const json = (await res.json().catch(() => ({}))) as { errors?: { description?: string }[] } & T;
  if (!res.ok) {
    const desc = json.errors?.map((x) => x.description).filter(Boolean).join("; ") || `HTTP ${res.status}`;
    throw new AsaasError(`Asaas: ${desc}`, res.status, json.errors);
  }
  return json;
}

/** Link da página do Asaas Checkout (sandbox e produção têm hosts diferentes). */
export function checkoutUrl(id: string, link?: string | null): string {
  if (link) return link;
  const host = env().ASAAS_BASE_URL.includes("sandbox") ? "https://sandbox.asaas.com" : "https://www.asaas.com";
  return `${host}/checkoutSession/show?id=${encodeURIComponent(id)}`;
}

export const asaas = {
  createCustomer: (input: { name: string; email: string; cpfCnpj: string; mobilePhone?: string | null; externalReference: string }) =>
    call<{ id: string }>("POST", "/customers", { ...input, notificationDisabled: false }),

  /** Assinatura por Pix: a cada ciclo o Asaas gera uma cobrança Pix (QR Code na fatura). */
  createPixSubscription: (input: { customer: string; value: number; nextDueDate: string; cycle: "MONTHLY" | "YEARLY"; description: string; externalReference: string; split?: AsaasSplit[] }) =>
    call<AsaasSubscription>("POST", "/subscriptions", { ...input, billingType: "PIX" }),

  /**
   * Cartão recorrente pelo Asaas Checkout (página segura do Asaas): o cliente informa
   * o cartão lá, o Asaas cria a assinatura e cobra o mesmo cartão a cada ciclo.
   * Nenhum dado de cartão passa pelo FinanceZap.
   */
  createRecurringCardCheckout: (input: {
    customer: string;
    value: number;
    cycle: "MONTHLY" | "YEARLY";
    nextDueDate: string; // "YYYY-MM-DD HH:mm:ss"
    itemName: string;
    itemDescription: string;
    externalReference: string;
    successUrl: string;
    cancelUrl: string;
    expiredUrl: string;
    splits?: AsaasSplit[];
  }) =>
    call<{ id: string; link?: string | null }>("POST", "/checkouts", {
      ...(input.splits?.length ? { splits: input.splits } : {}),
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 60,
      customer: input.customer,
      externalReference: input.externalReference,
      callback: { successUrl: input.successUrl, cancelUrl: input.cancelUrl, expiredUrl: input.expiredUrl },
      items: [{ name: input.itemName.slice(0, 30), description: input.itemDescription.slice(0, 150), quantity: 1, value: input.value }],
      subscription: { cycle: input.cycle, nextDueDate: input.nextDueDate },
    }),

  findCustomerByExternalReference: (externalReference: string) =>
    call<{ data: { id: string }[] }>("GET", `/customers?externalReference=${encodeURIComponent(externalReference)}`),

  listSubscriptionPayments: (subscriptionId: string) => call<{ data: AsaasPayment[] }>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`),

  getPayment: (paymentId: string) => call<AsaasPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`),

  getSubscription: (subscriptionId: string) => call<AsaasSubscription>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`),

  /** Carteira (walletId) da própria conta: um afiliado não pode receber split nela. */
  myWallets: () => call<{ data: { id: string }[] }>("GET", "/wallets"),

  /** Troca o split das próximas cobranças da assinatura ([] remove). */
  updateSubscriptionSplit: (subscriptionId: string, split: AsaasSplit[]) =>
    call<AsaasSubscription>("PUT", `/subscriptions/${encodeURIComponent(subscriptionId)}`, { split, updatePendingPayments: false }),

  /** Ajusta o split de uma cobrança já gerada (ex.: 1ª cobrança após o teste grátis). */
  updatePaymentSplit: (p: { id: string; billingType: string; value: number; dueDate: string }, split: AsaasSplit[]) =>
    call<AsaasPayment>("POST", `/payments/${encodeURIComponent(p.id)}`, { billingType: p.billingType, value: p.value, dueDate: p.dueDate, split }),

  cancelCheckout: (checkoutId: string) => call<unknown>("POST", `/checkouts/${encodeURIComponent(checkoutId)}/cancel`),

  cancelSubscription: (subscriptionId: string) => call<{ deleted: boolean; id: string }>("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`),
};
