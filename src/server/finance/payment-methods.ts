/** Formas de pagamento aceitas em lançamentos (mesmos valores que a IA devolve). */
export const PAYMENT_METHOD_LABELS = {
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  pix: "Pix",
  dinheiro: "Dinheiro",
  boleto: "Boleto",
  transferencia: "Transferência",
} as const;

export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABELS;

export const PAYMENT_METHOD_ICONS: Record<PaymentMethod, string> = {
  credito: "💳",
  debito: "💳",
  pix: "⚡",
  dinheiro: "💵",
  boleto: "🧾",
  transferencia: "🏦",
};

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && v in PAYMENT_METHOD_LABELS;
}

export function paymentMethodLabel(v: string | null | undefined): string | null {
  return isPaymentMethod(v) ? PAYMENT_METHOD_LABELS[v] : null;
}
