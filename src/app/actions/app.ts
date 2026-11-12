"use server";

import { revalidatePath } from "next/cache";
import { isPaymentMethod } from "@/server/finance/payment-methods";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireUser, endAllSessions } from "@/server/auth/session";
import { db, withUser } from "@/server/db/client";
import { budgetAlerts, users } from "@/server/db/schema";
import {
  archiveAccount,
  archiveCategory,
  createAccount,
  createCategory,
  createEntry,
  createRecurringRule,
  createRefund,
  createTransfer,
  deleteEntry,
  deleteAllEntries,
  markPaid,
  updateEntry,
} from "@/server/finance/engine";
import { FinanceError } from "@/server/finance/errors";
import { removeBudgetById, setBudget } from "@/server/finance/budgets";
import { parseBRL } from "@/server/finance/money";
import { todayIn } from "@/server/finance/dates";
import { getEntitlement } from "@/server/billing/entitlements";
import { cancelSubscription, checkoutSchema, startCheckout } from "@/server/billing/subscriptions";
import { createLinkCode, unlinkNumber } from "@/server/whatsapp/linking";
import { deleteAccount } from "@/server/account/privacy";
import { rateLimit } from "@/server/security/rate-limit";
import { verifyCredentials } from "@/server/auth/users";
import type { FormState } from "./auth";

async function guard<T>(fn: () => Promise<T>): Promise<FormState | T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.userMessage };
    if (err instanceof z.ZodError) return { error: err.issues[0].message };
    throw err;
  }
}

function money(v: FormDataEntryValue | null): number {
  const cents = parseBRL(String(v ?? ""));
  if (!cents) throw new FinanceError("invalid", "Informe um valor válido, ex.: 50,90");
  return cents;
}

const opt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

/* ---------------- Lançamentos ---------------- */
export async function saveEntryAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const today = todayIn(user.timezone);
  return guard(async () => {
    const id = opt(form.get("id"));
    const kind = z.enum(["income", "expense"]).parse(form.get("kind"));
    const amountCents = money(form.get("amount"));
    const occurredOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida").parse(form.get("occurredOn"));
    const base = {
      kind,
      amountCents,
      description: String(form.get("description") ?? ""),
      merchant: kind === "expense" ? opt(form.get("party")) : null,
      counterparty: kind === "income" ? opt(form.get("party")) : null,
      categoryId: opt(form.get("categoryId")),
      accountId: opt(form.get("accountId")) ?? undefined,
      occurredOn,
      status: (form.get("pending") === "on" ? "pending" : "paid") as "paid" | "pending",
      notes: opt(form.get("notes")),
      paymentMethod: (() => {
        const v = opt(form.get("paymentMethod"));
        return v && isPaymentMethod(v) ? v : null;
      })(),
    };
    await withUser(user.id, async (tx) => {
      if (id) {
        const version = Number(form.get("version"));
        await updateEntry(tx, user.id, id, { ...base, accountId: base.accountId ?? undefined, dueOn: base.status === "pending" ? occurredOn : null }, "user", { expectedVersion: version });
      } else {
        const installments = Number(form.get("installments") || 1);
        await createEntry(tx, user.id, { ...base, installments: installments > 1 ? installments : null, dueOn: base.status === "pending" ? occurredOn : null, source: "web" }, "user", today);
      }
    });
    revalidatePath("/app", "layout");
    return { message: id ? "Lançamento atualizado." : "Lançamento salvo." };
  });
}

export async function deleteEntryAction(form: FormData) {
  const user = await requireUser();
  const id = z.string().uuid().parse(form.get("id"));
  await withUser(user.id, (tx) => deleteEntry(tx, user.id, id, "user", { wholeInstallmentGroup: form.get("group") === "on" }));
  revalidatePath("/app", "layout");
}

export async function markPaidAction(form: FormData) {
  const user = await requireUser();
  const id = z.string().uuid().parse(form.get("id"));
  await withUser(user.id, (tx) => markPaid(tx, user.id, id, todayIn(user.timezone), "user"));
  revalidatePath("/app", "layout");
}

export async function refundAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    const id = z.string().uuid().parse(form.get("id"));
    const amount = opt(form.get("amount"));
    await withUser(user.id, (tx) => createRefund(tx, user.id, { originalId: id, amountCents: amount ? money(amount) : null, occurredOn: todayIn(user.timezone), source: "web" }, "user"));
    revalidatePath("/app", "layout");
    return { message: "Estorno registrado." };
  });
}

export async function transferAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    await withUser(user.id, (tx) =>
      createTransfer(
        tx,
        user.id,
        {
          fromAccountId: z.string().uuid("Escolha a conta de origem").parse(form.get("from")),
          toAccountId: z.string().uuid("Escolha a conta de destino").parse(form.get("to")),
          amountCents: money(form.get("amount")),
          occurredOn: String(form.get("occurredOn") || todayIn(user.timezone)),
          description: opt(form.get("description")) ?? undefined,
          source: "web",
        },
        "user",
      ),
    );
    revalidatePath("/app", "layout");
    return { message: "Movimentação registrada." };
  });
}

/* ---------------- Contas e cartões ---------------- */
export async function createAccountAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    const ent = await getEntitlement(user.id);
    const max = ent.active ? ent.limits.maxAccounts : 2;
    const type = z.enum(["checking", "savings", "cash", "wallet", "investment", "credit_card"]).parse(form.get("type"));
    const initial = opt(form.get("initial"));
    const limit = opt(form.get("limit"));
    await withUser(user.id, (tx) =>
      createAccount(
        tx,
        user.id,
        {
          name: String(form.get("name") ?? ""),
          type,
          initialBalanceCents: initial ? (initial.startsWith("-") ? -money(initial.slice(1)) : money(initial)) : 0,
          creditLimitCents: limit ? money(limit) : null,
          closingDay: type === "credit_card" ? Number(form.get("closingDay")) || null : null,
          dueDay: type === "credit_card" ? Number(form.get("dueDay")) || null : null,
        },
        max,
      ),
    );
    revalidatePath("/app/contas");
    return { message: "Conta criada." };
  });
}

export async function archiveAccountAction(form: FormData) {
  const user = await requireUser();
  await withUser(user.id, (tx) => archiveAccount(tx, user.id, z.string().uuid().parse(form.get("id"))));
  revalidatePath("/app/contas");
}

/* ---------------- Limites de gasto ---------------- */
export async function saveBudgetAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    const slug = opt(form.get("category"));
    await withUser(user.id, (tx) => setBudget(tx, user.id, slug, money(form.get("amount"))));
    revalidatePath("/app/limites");
    revalidatePath("/app");
    return { message: "Limite salvo. Você recebe um aviso no WhatsApp ao chegar em 80% e em 100%." };
  });
}

export async function removeBudgetAction(form: FormData) {
  const user = await requireUser();
  await withUser(user.id, (tx) => removeBudgetById(tx, user.id, z.string().uuid().parse(form.get("id"))));
  revalidatePath("/app/limites");
  revalidatePath("/app");
}

/* ---------------- Categorias e recorrências ---------------- */
export async function createCategoryAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    const ent = await getEntitlement(user.id);
    if (!ent.active || !ent.limits.customCategories) throw new FinanceError("limit", "Categorias personalizadas fazem parte do plano Pro ou superior.");
    await withUser(user.id, (tx) => createCategory(tx, user.id, { name: String(form.get("name") ?? ""), kind: z.enum(["income", "expense"]).parse(form.get("kind")), icon: opt(form.get("icon")) ?? undefined }));
    revalidatePath("/app/categorias");
    return { message: "Categoria criada." };
  });
}

export async function archiveCategoryAction(form: FormData) {
  const user = await requireUser();
  await withUser(user.id, (tx) => archiveCategory(tx, user.id, z.string().uuid().parse(form.get("id"))));
  revalidatePath("/app/categorias");
}

export async function createRecurringAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    await withUser(user.id, (tx) =>
      createRecurringRule(tx, user.id, {
        kind: z.enum(["income", "expense"]).parse(form.get("kind")),
        amountCents: money(form.get("amount")),
        description: String(form.get("description") ?? "").trim() || "Recorrente",
        categoryId: opt(form.get("categoryId")),
        accountId: opt(form.get("accountId")),
        dayOfMonth: z.coerce.number().int().min(1, "Dia inválido").max(31, "Dia inválido").parse(form.get("day")),
        startOn: todayIn(user.timezone),
      }),
    );
    revalidatePath("/app/categorias");
    return { message: "Recorrência criada. As contas a pagar aparecem 7 dias antes do vencimento." };
  });
}

/* ---------------- WhatsApp ---------------- */
export async function createLinkCodeAction(): Promise<{ code: string; waLink: string | null; expiresAt: string }> {
  const user = await requireUser();
  const r = await createLinkCode(user.id);
  return { code: r.code, waLink: r.waLink, expiresAt: r.expiresAt.toISOString() };
}

export async function unlinkWhatsappAction() {
  const user = await requireUser();
  await unlinkNumber(user.id);
  revalidatePath("/app/whatsapp");
}

/* ---------------- Assinatura ---------------- */
export async function checkoutAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!(await rateLimit(`checkout:${user.id}`, 6, 3600))) return { error: "Muitas tentativas de pagamento. Aguarde alguns minutos." };
  const result = await guard(async () => {
    const input = checkoutSchema.parse({ planSlug: form.get("plan"), cycle: form.get("cycle"), method: form.get("method"), cpfCnpj: form.get("cpfCnpj") ?? "" });
    return startCheckout(user.id, input);
  });
  if (result && "error" in result) return result;
  const r = result as { redirectUrl: string | null };
  if (r.redirectUrl) redirect(r.redirectUrl);
  revalidatePath("/app/assinatura");
  return { message: "Cobrança criada. O Asaas enviou o link de pagamento para o seu e-mail." };
}

export async function cancelSubscriptionAction(_: FormState): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    await cancelSubscription(user.id);
    revalidatePath("/app/assinatura");
    return { message: "Assinatura cancelada. Você mantém o acesso até o fim do período pago." };
  });
}

/* ---------------- Conta ---------------- */
export async function updateProfileAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    const data = z
      .object({
        name: z.string().trim().min(2, "Informe seu nome").max(80),
        timezone: z.string().refine((tz) => {
          try {
            new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, "Fuso horário inválido"),
      })
      .parse({ name: form.get("name"), timezone: form.get("timezone") });
    await db().update(users).set(data).where(eq(users.id, user.id));
    revalidatePath("/app/conta");
    return { message: "Dados atualizados." };
  });
}

export async function deleteAllEntriesAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (String(form.get("confirm") ?? "").trim().toUpperCase() !== "APAGAR") return { error: "Digite APAGAR para confirmar." };
  const ok = await verifyCredentials(user.email, String(form.get("password") ?? ""));
  if (!ok) return { error: "Senha incorreta." };
  const raw = String(form.get("scope") ?? "all");
  const scope = raw === "expense" || raw === "income" ? raw : null;
  const res = await guard(async () => {
    const n = await withUser(user.id, async (tx) => {
      const count = await deleteAllEntries(tx, user.id, "user", scope);
      // Os avisos de limite do mês voltam a valer para os próximos lançamentos
      if (scope !== "income") await tx.delete(budgetAlerts).where(eq(budgetAlerts.userId, user.id));
      return count;
    });
    const what = scope === "expense" ? ["gasto apagado", "gastos apagados", "gastos"] : scope === "income" ? ["recebimento apagado", "recebimentos apagados", "recebimentos"] : ["lançamento apagado", "lançamentos apagados", "lançamentos"];
    return { message: n ? `Pronto: ${n} ${n === 1 ? what[0] : what[1]}. Contas, categorias, limites e contas fixas continuam cadastrados.` : `Você não tinha ${what[2]} para apagar.` };
  });
  revalidatePath("/app", "layout");
  return res;
}

export async function deleteAccountAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (String(form.get("confirm") ?? "") !== "EXCLUIR") return { error: "Digite EXCLUIR para confirmar." };
  const ok = await verifyCredentials(user.email, String(form.get("password") ?? ""));
  if (!ok) return { error: "Senha incorreta." };
  const res = await guard(async () => {
    await deleteAccount(user.id);
    await endAllSessions(user.id);
    return null;
  });
  if (res) return res;
  redirect("/?conta=excluida");
}
