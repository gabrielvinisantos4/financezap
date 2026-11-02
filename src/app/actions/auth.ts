"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createUser, signupSchema, verifyCredentials } from "@/server/auth/users";
import { endSession, startSession } from "@/server/auth/session";
import { rateLimit } from "@/server/security/rate-limit";
import { FinanceError } from "@/server/finance/errors";
import { applySignupPerks } from "@/server/auth/signup-perks";
import { env } from "@/server/config/env";

export type FormState = { error?: string; message?: string } | null;

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  const ip = await clientIp();
  if (!(await rateLimit(`signup:${ip}`, 5, 3600))) return { error: "Muitas tentativas. Tente novamente em uma hora." };
  const parsed = signupSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    password: form.get("password"),
    phone: form.get("phone") || undefined,
    acceptTerms: form.get("acceptTerms") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const user = await createUser(parsed.data, { ip });
    await applySignupPerks(user.id, user.email);
    await startSession(user.id);
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.userMessage };
    throw err;
  }
  const plan = String(form.get("plan") ?? "");
  if (env().AUTO_TRIAL_PLAN) redirect(env().SIMULATOR_ENABLED ? "/app/simulador" : "/app/whatsapp");
  redirect(plan ? `/app/assinatura?plano=${encodeURIComponent(plan)}` : "/app/assinatura");
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();
  if (!(await rateLimit(`login:${ip}`, 20, 900)) || !(await rateLimit(`login:${email}`, 8, 900))) {
    return { error: "Muitas tentativas de acesso. Aguarde 15 minutos." };
  }
  const user = await verifyCredentials(email, password);
  if (!user) return { error: "E-mail ou senha incorretos." };
  if (user.status === "deleted") return { error: "E-mail ou senha incorretos." };
  await startSession(user.id);
  redirect(user.role === "user" ? "/app" : "/admin");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}
