"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/server/auth/session";
import { createAffiliate, setAffiliateStatus, setAffiliateWallet } from "@/server/affiliates/affiliates";
import { FinanceError } from "@/server/finance/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { db } from "@/server/db/client";
import { adminAuditLogs } from "@/server/db/schema";
import type { FormState } from "./auth";

async function guard(fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.userMessage };
    if (err instanceof z.ZodError) return { error: err.issues[0].message };
    throw err;
  }
}

export async function joinAffiliateAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  return guard(async () => {
    if (form.get("accept") !== "on") return { error: "É preciso aceitar as regras do programa." };
    await createAffiliate(user.id, String(form.get("code") ?? ""));
    revalidatePath("/app/afiliados");
    return { message: "Pronto! Seu link de afiliado está ativo." };
  });
}

export async function saveWalletAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!(await rateLimit(`wallet:${user.id}`, 10, 3600))) return { error: "Muitas tentativas. Tente de novo em uma hora." };
  return guard(async () => {
    await setAffiliateWallet(user.id, String(form.get("walletId") ?? ""));
    revalidatePath("/app/afiliados");
    return { message: "Carteira salva. As comissões passam a cair direto na sua conta do Asaas." };
  });
}

export async function setAffiliateStatusAction(form: FormData) {
  const admin = await requireAdmin("manage_users");
  const id = z.string().uuid().parse(form.get("id"));
  const status = z.enum(["active", "blocked"]).parse(form.get("status"));
  const reason = String(form.get("reason") ?? "").slice(0, 200) || null;
  await setAffiliateStatus(id, status, reason);
  await db().insert(adminAuditLogs).values({ adminId: admin.id, action: status === "blocked" ? "affiliate.block" : "affiliate.unblock", reason, meta: { affiliateId: id } });
  revalidatePath("/admin/afiliados");
}
