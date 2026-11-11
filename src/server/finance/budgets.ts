import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "../db/client";
import { budgetAlerts, budgets, categories } from "../db/schema";
import { endOfMonth, startOfMonth, monthLabel, type ISODate } from "./dates";
import { FinanceError } from "./errors";
import { formatBRL } from "./money";
import { periodSummary, totalsByCategory } from "./queries";

/**
 * Limites de gasto mensais.
 * - Por categoria de despesa, ou o limite TOTAL do mês (categoria nula).
 * - O gasto considerado é o mesmo dos relatórios: despesas pagas no mês menos estornos.
 * - Alertas em 80% e 100%, uma vez por limite e por mês.
 */

export const ALERT_THRESHOLDS = [80, 100] as const;

export type BudgetStatus = {
  id: string;
  categoryId: string | null;
  name: string; // "Total do mês" ou nome da categoria
  icon: string;
  slug: string | null;
  limitCents: number;
  spentCents: number;
  pct: number; // 0..∞, inteiro
};

export async function setBudget(tx: Tx, userId: string, categorySlug: string | null, amountCents: number): Promise<{ name: string; icon: string; created: boolean }> {
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 2_000_000_000) throw new FinanceError("invalid", "Informe um valor de limite válido.");
  let categoryId: string | null = null;
  let name = "Total do mês";
  let icon = "📊";
  if (categorySlug) {
    const [c] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.userId, userId), eq(categories.kind, "expense"), eq(categories.slug, categorySlug), isNull(categories.archivedAt)));
    if (!c) throw new FinanceError("not_found", "Não encontrei essa categoria de despesa.");
    categoryId = c.id;
    name = c.name;
    icon = c.icon;
  }
  const where = and(eq(budgets.userId, userId), categoryId ? eq(budgets.categoryId, categoryId) : isNull(budgets.categoryId));
  const [existing] = await tx.select().from(budgets).where(where);
  if (existing) {
    await tx.update(budgets).set({ amountCents, updatedAt: new Date() }).where(eq(budgets.id, existing.id));
    // Mudou o limite: libera novos avisos no mês, já que a régua mudou
    await tx.delete(budgetAlerts).where(eq(budgetAlerts.budgetId, existing.id));
    return { name, icon, created: false };
  }
  await tx.insert(budgets).values({ userId, categoryId, amountCents });
  return { name, icon, created: true };
}

export async function removeBudget(tx: Tx, userId: string, categorySlug: string | null): Promise<string | null> {
  const rows = await budgetStatuses(tx, userId, "2000-01-01");
  const target = rows.find((b) => (categorySlug ? b.slug === categorySlug : b.categoryId === null));
  if (!target) return null;
  await tx.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.id, target.id)));
  return target.name;
}

export async function removeBudgetById(tx: Tx, userId: string, id: string) {
  await tx.delete(budgets).where(and(eq(budgets.userId, userId), eq(budgets.id, id)));
}

/** Limites com o gasto do mês de `today`. Total do mês primeiro, depois categorias por % usado. */
export async function budgetStatuses(tx: Tx, userId: string, today: ISODate): Promise<BudgetStatus[]> {
  const rows = await tx
    .select({ id: budgets.id, categoryId: budgets.categoryId, amountCents: budgets.amountCents, name: categories.name, icon: categories.icon, slug: categories.slug })
    .from(budgets)
    .leftJoin(categories, eq(categories.id, budgets.categoryId))
    .where(eq(budgets.userId, userId));
  if (!rows.length) return [];
  const period = { from: startOfMonth(today), to: endOfMonth(today), label: "" };
  const byCat = rows.some((r) => r.categoryId) ? await totalsByCategory(tx, userId, period, "expense") : [];
  const total = rows.some((r) => !r.categoryId) ? (await periodSummary(tx, userId, period)).netExpenseCents : 0;
  const list = rows.map((r) => {
    const spent = r.categoryId ? Math.max(0, byCat.find((c) => c.categoryId === r.categoryId)?.totalCents ?? 0) : Math.max(0, total);
    return {
      id: r.id,
      categoryId: r.categoryId,
      name: r.categoryId ? (r.name ?? "Categoria") : "Total do mês",
      icon: r.categoryId ? (r.icon ?? "•") : "📊",
      slug: r.slug ?? null,
      limitCents: r.amountCents,
      spentCents: spent,
      pct: Math.floor((spent * 100) / r.amountCents),
    };
  });
  return list.sort((a, b) => (a.categoryId === null ? -1 : b.categoryId === null ? 1 : b.pct - a.pct));
}

/**
 * Depois de registrar despesas: verifica os limites afetados (as categorias tocadas e o total)
 * e devolve os avisos novos. Cada faixa (80%, 100%) é avisada uma única vez por mês, mesmo
 * com mensagens chegando ao mesmo tempo (chave única no banco).
 */
export async function newBudgetAlerts(tx: Tx, userId: string, today: ISODate, touchedCategoryIds: (string | null)[]): Promise<string[]> {
  const statuses = await budgetStatuses(tx, userId, today);
  if (!statuses.length) return [];
  const touched = new Set(touchedCategoryIds.filter(Boolean));
  const periodStart = startOfMonth(today);
  const messages: string[] = [];
  for (const b of statuses) {
    if (b.categoryId !== null && !touched.has(b.categoryId)) continue;
    const crossed = ALERT_THRESHOLDS.filter((t) => b.pct >= t);
    if (!crossed.length) continue;
    const inserted = await tx
      .insert(budgetAlerts)
      .values(crossed.map((threshold) => ({ userId, budgetId: b.id, periodStart, threshold })))
      .onConflictDoNothing()
      .returning({ threshold: budgetAlerts.threshold });
    if (!inserted.length) continue;
    const top = Math.max(...inserted.map((r) => r.threshold));
    messages.push(alertText(b, top, today));
  }
  return messages;
}

function alertText(b: BudgetStatus, threshold: number, today: ISODate): string {
  const what = b.categoryId ? `de *${b.name}*` : "*total do mês*";
  const used = `${formatBRL(b.spentCents)} de ${formatBRL(b.limitCents)}`;
  if (threshold >= 100) {
    const over = b.spentCents - b.limitCents;
    return over > 0
      ? `🚨 Você passou do limite ${what}: ${used} (${formatBRL(over)} acima) em ${monthLabel(today)}.`
      : `🚨 Você atingiu o limite ${what}: ${used} em ${monthLabel(today)}.`;
  }
  return `⚠️ Atenção: você já usou ${b.pct}% do limite ${what} (${used}). Restam ${formatBRL(b.limitCents - b.spentCents)} até o fim do mês.`;
}

/** Texto da consulta "como estão meus limites?". */
export function budgetsReply(list: BudgetStatus[], today: ISODate): string {
  if (!list.length) {
    return 'Você ainda não definiu limites. 🎯\n\nExemplos:\n• "limite de 800 para alimentação"\n• "meu limite do mês é 3 mil"';
  }
  const lines = [`🎯 Seus limites em ${monthLabel(today)}`, ""];
  for (const b of list) {
    const flag = b.pct >= 100 ? "🔴" : b.pct >= 80 ? "🟡" : "🟢";
    lines.push(`${flag} ${b.icon} ${b.name}: ${formatBRL(b.spentCents)} de ${formatBRL(b.limitCents)} (${b.pct}%)`);
    lines.push(`   ${progressBar(b.pct)} ${b.spentCents <= b.limitCents ? `restam ${formatBRL(b.limitCents - b.spentCents)}` : `${formatBRL(b.spentCents - b.limitCents)} acima`}`);
  }
  return lines.join("\n");
}

export function progressBar(pct: number, size = 10): string {
  const filled = Math.max(0, Math.min(size, Math.round((pct / 100) * size)));
  return "▓".repeat(filled) + "░".repeat(size - filled);
}
