"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { attachReferral, REF_COOKIE } from "@/server/affiliates/affiliates";
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
  if (!parsed.data.phone) return { error: "Informe seu WhatsApp com DDD." };
  const emailConfirm = String(form.get("emailConfirm") ?? "").trim().toLowerCase();
  if (emailConfirm !== parsed.data.email) return { error: "Os e-mails não conferem. Digite o mesmo e-mail nos dois campos." };
  if (String(form.get("passwordConfirm") ?? "") !== parsed.data.password) return { error: "As senhas não conferem. Digite a mesma senha nos dois campos." };
  try {
    const user = await createUser(parsed.data, { ip });
    await applySignupPerks(user.id, user.email);
    await attachReferral(user.id, (await cookies()).get(REF_COOKIE)?.value).catch(() => undefined);
    await startSession(user.id);
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.userMessage };
    throw err;
  }
  if (form.get("affiliate") === "1") redirect("/app/afiliados");
  const plan = String(form.get("plan") ?? "");
  if (env().AUTO_TRIAL_PLAN && !plan) redirect(env().SIMULATOR_ENABLED ? "/app/simulador" : "/app/whatsapp");
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
  const back = String(form.get("back") ?? "");
  redirect(/^\/app(\/[a-z-]*)?$/.test(back) ? back : user.role === "user" ? "/app" : "/admin");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}
