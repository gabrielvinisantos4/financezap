import type { Transaction } from "../db/schema";
import { formatBRL } from "../finance/money";
import { formatBR, monthLabel } from "../finance/dates";
import type { Availability, CategoryTotal, Summary, TxWithCategory } from "../finance/queries";

export type Button = { id: string; title: string };
export type Reply = { text: string; buttons?: Button[] };

const KIND_LABEL: Record<Transaction["kind"], string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
  card_payment: "Pagamento de fatura",
  refund: "Estorno",
};

/** Linha curta para listas e confirmações. */
export function txLine(t: Transaction & { categoryIcon?: string | null }, opts: { withDate?: boolean } = {}): string {
  const sign = t.kind === "income" || t.kind === "refund" ? "+" : t.kind === "expense" ? "−" : "↔";
  const date = opts.withDate === false ? "" : `${formatBR(t.occurredOn).slice(0, 5)} · `;
  const pending = t.status === "pending" ? " (a pagar)" : "";
  return `${date}${t.categoryIcon ? `${t.categoryIcon} ` : ""}${t.description} · ${sign}${formatBRL(t.amountCents)}${pending}`;
}

export function recordedReply(rows: Transaction[], category: { name: string; icon: string } | null, opts: { merchant?: string | null; counterparty?: string | null }): Reply {
  const first = rows[0];
  const total = rows.reduce((s, r) => s + r.amountCents, 0);
  const isIncome = first.kind === "income";
  const pending = first.status === "pending";
  const title = pending ? (isIncome ? "✅ Conta a receber registrada!" : "✅ Conta a pagar registrada!") : isIncome ? "✅ Receita registrada!" : "✅ Despesa registrada!";
  const lines = [title, ""];
  if (category) lines.push(`${category.icon} ${category.name}`);
  if (opts.merchant) lines.push(`📍 ${opts.merchant}`);
  if (opts.counterparty) lines.push(`👤 ${opts.counterparty}`);
  if (rows.length > 1) {
    lines.push(`💰 ${formatBRL(total)} em ${rows.length}x de ${formatBRL(rows[rows.length - 1].amountCents)}`);
    lines.push(`📅 1ª parcela: ${formatBR(first.occurredOn)}`);
  } else {
    lines.push(`💰 ${formatBRL(total)}`);
    lines.push(pending && first.dueOn ? `📅 Vencimento: ${formatBR(first.dueOn)}` : `📅 Data: ${formatBR(first.occurredOn)}`);
  }
  lines.push("", "Seu lançamento foi salvo com sucesso.");
  return { text: lines.join("\n") };
}

export function multiRecordedReply(items: { rows: Transaction[]; category: { name: string; icon: string } | null }[]): Reply {
  const lines = [`✅ ${items.length} lançamentos registrados!`, ""];
  const sameDate = items.every((it) => it.rows[0].occurredOn === items[0].rows[0].occurredOn);
  for (const it of items) {
    const t = it.rows[0];
    const sign = t.kind === "income" ? "+" : "−";
    const date = sameDate ? "" : ` · ${formatBR(t.occurredOn)}`;
    lines.push(`${it.category?.icon ?? "•"} ${t.description} · ${sign}${formatBRL(it.rows.reduce((s, r) => s + r.amountCents, 0))}${date}`);
  }
  if (sameDate) lines.push("", `📅 Data: ${formatBR(items[0].rows[0].occurredOn)}`);
  return { text: lines.join("\n") };
}

export function summaryReply(label: string, s: Summary): Reply {
  const lines = [`📊 Resumo ${label}`, "", `🟢 Entradas: ${formatBRL(s.incomeCents)}`, `🔴 Saídas: ${formatBRL(s.netExpenseCents)}`];
  if (s.refundCents) lines.push(`   (já descontados ${formatBRL(s.refundCents)} de estornos)`);
  lines.push(`${s.resultCents >= 0 ? "✅" : "⚠️"} Resultado: ${formatBRL(s.resultCents)}`);
  return { text: lines.join("\n") };
}

export function totalReply(kind: "income" | "expense", label: string, cents: number, count: number): Reply {
  if (count === 0 && cents === 0) {
    return { text: kind === "expense" ? `Não encontrei despesas ${label}. 🙌` : `Não encontrei receitas ${label}.` };
  }
  const head = kind === "expense" ? `🔴 Você gastou ${formatBRL(cents)} ${label}.` : `🟢 Entraram ${formatBRL(cents)} ${label}.`;
  return { text: `${head}\n${count} lançamento${count === 1 ? "" : "s"}.` };
}

export function categoriesReply(label: string, kind: "income" | "expense", rows: CategoryTotal[]): Reply {
  if (!rows.length) return { text: `Nada registrado ${label}.` };
  const total = rows.reduce((s, r) => s + r.totalCents, 0);
  const lines = [`${kind === "expense" ? "🔴 Despesas" : "🟢 Receitas"} por categoria ${label}`, ""];
  for (const r of rows.slice(0, 12)) {
    const pct = total ? Math.round((r.totalCents / total) * 100) : 0;
    lines.push(`${r.icon} ${r.name}: ${formatBRL(r.totalCents)} (${pct}%)`);
  }
  lines.push("", `Total: ${formatBRL(total)}`);
  return { text: lines.join("\n") };
}

export function partiesReply(label: string, kind: "income" | "expense", rows: { party: string; totalCents: number; count: number }[], search: string | null): Reply {
  if (!rows.length) {
    return { text: search ? `Não encontrei ${kind === "expense" ? "gastos" : "recebimentos"} com "${search}" ${label}.` : `Nada registrado ${label}.` };
  }
  if (search) {
    const total = rows.reduce((s, r) => s + r.totalCents, 0);
    const count = rows.reduce((s, r) => s + r.count, 0);
    return { text: `${kind === "expense" ? "🔴 Gastos" : "🟢 Recebimentos"} com "${search}" ${label}: ${formatBRL(total)} (${count} lançamento${count === 1 ? "" : "s"}).` };
  }
  const lines = [kind === "expense" ? `🏪 Gastos por estabelecimento ${label}` : `👤 Recebimentos por cliente ${label}`, ""];
  for (const r of rows.slice(0, 15)) lines.push(`• ${r.party}: ${formatBRL(r.totalCents)}`);
  return { text: lines.join("\n") };
}

export function largestReply(kind: "income" | "expense", label: string, t: Transaction | null): Reply {
  if (!t) return { text: `Não encontrei ${kind === "expense" ? "despesas" : "receitas"} ${label}.` };
  return { text: `${kind === "expense" ? "🔴 Maior despesa" : "🟢 Maior receita"} ${label}:\n${t.description} · ${formatBRL(t.amountCents)} em ${formatBR(t.occurredOn)}.` };
}

export function recentReply(rows: TxWithCategory[]): Reply {
  if (!rows.length) return { text: "Você ainda não tem lançamentos. Experimente: \"gastei 50 no posto\"." };
  const lines = [`🧾 Últimos ${rows.length} lançamentos`, ""];
  rows.forEach((t, i) => lines.push(`${i + 1}. ${txLine(t)}`));
  return { text: lines.join("\n") };
}

export function availabilityReply(a: Availability): Reply {
  const lines = ["💼 Sua posição hoje", ""];
  for (const acc of a.accounts) {
    if (acc.type === "credit_card") {
      lines.push(`💳 ${acc.name}: fatura ${formatBRL(Math.max(0, -acc.balanceCents))}`);
    } else {
      lines.push(`🏦 ${acc.name}: ${formatBRL(acc.balanceCents)}`);
    }
  }
  lines.push("", `✅ Disponível nas contas: ${formatBRL(a.availableCents)}`);
  const committed = a.cardDebtCents + a.payablesCents + a.futureCardInstallmentsCents;
  if (committed) {
    lines.push(`⏳ Comprometido: ${formatBRL(committed)}`);
    if (a.cardDebtCents) lines.push(`   • faturas em aberto: ${formatBRL(a.cardDebtCents)}`);
    if (a.futureCardInstallmentsCents) lines.push(`   • parcelas futuras no cartão: ${formatBRL(a.futureCardInstallmentsCents)}`);
    if (a.payablesCents) lines.push(`   • contas a pagar: ${formatBRL(a.payablesCents)}`);
  }
  if (a.receivablesCents) lines.push(`📥 A receber: ${formatBRL(a.receivablesCents)}`);
  lines.push(`📈 Projeção: ${formatBRL(a.projectedCents)}`);
  lines.push("", "Os saldos consideram o saldo inicial das contas e o que foi registrado aqui.");
  return { text: lines.join("\n") };
}

export function payablesReply(rows: Transaction[], today: string): Reply {
  if (!rows.length) return { text: "Você não tem contas a pagar pendentes. 🎉" };
  const lines = ["📌 Contas a pagar", ""];
  let total = 0;
  for (const t of rows) {
    total += t.amountCents;
    const late = t.dueOn && t.dueOn < today ? " ⚠️ atrasada" : "";
    lines.push(`• ${t.dueOn ? formatBR(t.dueOn) : "—"} · ${t.description} · ${formatBRL(t.amountCents)}${late}`);
  }
  lines.push("", `Total: ${formatBRL(total)}`);
  return { text: lines.join("\n") };
}

export function evolutionReply(rows: { month: string; incomeCents: number; expenseCents: number; resultCents: number }[]): Reply {
  const lines = ["📈 Evolução mensal", ""];
  for (const r of rows) {
    lines.push(`${monthLabel(r.month)}: +${formatBRL(r.incomeCents)} / −${formatBRL(r.expenseCents)} = ${r.resultCents >= 0 ? "✅" : "⚠️"} ${formatBRL(r.resultCents)}`);
  }
  return { text: lines.join("\n") };
}

export function describeTx(t: Transaction & { categoryName?: string | null }): string {
  return `${KIND_LABEL[t.kind]}: ${t.description} · ${formatBRL(t.amountCents)} · ${formatBR(t.occurredOn)}${t.categoryName ? ` · ${t.categoryName}` : ""}`;
}

export const HELP_TEXT = [
  "👋 Eu sou seu assistente financeiro. É só escrever do seu jeito:",
  "",
  "📝 Registrar",
  "• \"Gastei 50 no posto\"",
  "• \"Recebi 1.200 de um cliente de marketing\"",
  "• \"Comprei um fone de 300 em 3x no cartão\"",
  "",
  "🔎 Consultar",
  "• \"Quanto gastei hoje?\"",
  "• \"Quanto gastei com combustível em outubro?\"",
  "• \"Quanto tenho disponível?\"",
  "• \"Mostra meus últimos 10 lançamentos\"",
  "",
  "✏️ Corrigir",
  "• \"Errei o valor, era 70\"",
  "• \"Apaga o último gasto\"",
  "",
  "No painel web você vê gráficos, contas, cartões e relatórios.",
].join("\n");
