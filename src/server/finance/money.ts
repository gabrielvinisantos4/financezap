/**
 * Dinheiro é sempre tratado em centavos inteiros. Nada de float em cálculo financeiro.
 */

const MAX_CENTS = 2_000_000_000; // ~R$ 20 milhões por lançamento (limite do int4)

/** Converte número em reais (já parseado/validado) para centavos sem erro de ponto flutuante. */
export function reaisToCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Valor inválido");
  const cents = Math.round(Number((value * 100).toFixed(4)));
  return cents;
}

export function assertValidAmount(cents: number) {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error("O valor precisa ser maior que zero");
  if (cents > MAX_CENTS) throw new Error("Valor acima do limite permitido");
}

/**
 * Interpreta valores escritos em pt-BR: "50", "50,90", "1.200", "1.200,50", "R$ 85",
 * "mil", "2 mil", "1,5 mil", "1.5k". Retorna centavos ou null.
 */
export function parseBRL(input: string): number | null {
  let s = input.trim().toLowerCase().replace(/r\$\s*/g, "").replace(/\s+reais?$/, "").trim();
  if (!s) return null;

  let multiplier = 1;
  const milMatch = s.match(/^(.*?)\s*(mil|k)$/);
  if (milMatch) {
    multiplier = 1000;
    s = milMatch[1].trim() || "1";
  }

  // "1.200,50" -> 1200.50 ; "1,5" -> 1.5 ; "1.200" -> 1200 ; "1.5" (com mil) -> 1.5
  let normalized: string;
  if (s.includes(",")) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, "");
  } else {
    normalized = s;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized) && !(multiplier > 1 && /^\d+(\.\d+)?$/.test(normalized))) {
    return null;
  }
  const value = Number(normalized) * multiplier;
  if (!Number.isFinite(value) || value <= 0) return null;
  return reaisToCents(value);
}

const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  // Intl usa espaço não separável; normalizamos para espaço comum (melhor no WhatsApp)
  return fmt.format(cents / 100).replace(/ /g, " ");
}

/** Divide um total em N parcelas inteiras; a diferença de centavos vai para a primeira. */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1 || n > 72) throw new Error("Número de parcelas inválido");
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + remainder : base));
}
