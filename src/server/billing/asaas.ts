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
};

export type AsaasSubscription = { id: string; customer: string; status: string; value: number; cycle: string; nextDueDate: string; externalReference?: string | null; deleted?: boolean };

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

export const asaas = {
  createCustomer: (input: { name: string; email: string; cpfCnpj: string; mobilePhone?: string | null; externalReference: string }) =>
    call<{ id: string }>("POST", "/customers", { ...input, notificationDisabled: false }),

  createSubscription: (input: { customer: string; value: number; nextDueDate: string; cycle: "MONTHLY" | "YEARLY"; description: string; externalReference: string }) =>
    // billingType UNDEFINED: o cliente escolhe Pix, boleto ou cartão na página da fatura
    call<AsaasSubscription>("POST", "/subscriptions", { ...input, billingType: "UNDEFINED" }),

  listSubscriptionPayments: (subscriptionId: string) => call<{ data: AsaasPayment[] }>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}/payments`),

  getPayment: (paymentId: string) => call<AsaasPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`),

  getSubscription: (subscriptionId: string) => call<AsaasSubscription>("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`),

  cancelSubscription: (subscriptionId: string) => call<{ deleted: boolean; id: string }>("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`),
};
