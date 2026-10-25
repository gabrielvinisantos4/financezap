"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { audit, planSchema, savePlan, setUserBlocked } from "@/server/admin/admin";
import { grantManualSubscription } from "@/server/billing/subscriptions";
import { parseBRL } from "@/server/finance/money";
import { FinanceError } from "@/server/finance/errors";
import type { FormState } from "./auth";

export async function blockUserAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin("manage_users");
  try {
    await setUserBlocked(admin, z.string().uuid().parse(form.get("id")), form.get("block") === "1", String(form.get("reason") ?? ""));
    revalidatePath("/admin/clientes");
    return { message: form.get("block") === "1" ? "Acesso bloqueado." : "Acesso reativado." };
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.userMessage };
    throw err;
  }
}

export async function grantCourtesyAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin("manage_plans");
  try {
    const id = z.string().uuid().parse(form.get("id"));
    const days = z.coerce.number().int().min(1).max(365).parse(form.get("days"));
    const plan = String(form.get("plan") ?? "");
    await grantManualSubscription(id, plan, days);
    await audit(admin.id, "subscription.courtesy", id, String(form.get("reason") ?? "").slice(0, 300) || null, { plan, days });
    revalidatePath("/admin/clientes");
    return { message: `Acesso de cortesia liberado por ${days} dias.` };
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.userMessage };
    if (err instanceof z.ZodError) return { error: "Dados inválidos." };
    throw err;
  }
}

export async function savePlanAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireAdmin("manage_plans");
  try {
    const parsed = planSchema.parse({
      id: form.get("id") || undefined,
      slug: form.get("slug"),
      name: form.get("name"),
      description: form.get("description") ?? "",
      priceMonthlyCents: parseBRL(String(form.get("priceMonthly") ?? "")) ?? 0,
      priceYearlyCents: parseBRL(String(form.get("priceYearly") ?? "")) ?? 0,
      features: String(form.get("features") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
      monthlyMessages: form.get("monthlyMessages"),
      monthlyAiCalls: form.get("monthlyAiCalls"),
      maxAccounts: form.get("maxAccounts"),
      customCategories: form.get("customCategories") === "on",
      advancedReports: form.get("advancedReports") === "on",
      active: form.get("active") === "on",
      sortOrder: form.get("sortOrder") ?? 0,
    });
    await savePlan(admin, parsed);
    revalidatePath("/admin/planos");
    revalidatePath("/");
    return { message: "Plano salvo." };
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.userMessage };
    if (err instanceof z.ZodError) return { error: err.issues[0].message };
    throw err;
  }
}
