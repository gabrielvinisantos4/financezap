import Link from "next/link";
import { PasswordInput } from "@/components/password-input";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/forms";
import { loginAction } from "@/app/actions/auth";
import { currentUser } from "@/server/auth/session";

export const metadata = { title: "Entrar" };

const safeBack = (v?: string) => (v && /^\/(app|admin)(\/[a-z-]*)?$/.test(v) ? v : "");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const back = safeBack((await searchParams).voltar);
  const u = await currentUser();
  const restricted = back.startsWith("/admin");
  if (u) redirect(u.role === "user" ? (restricted ? "/app" : back || "/app") : back || "/admin");
  return (
    <>
      <h1 className="text-[2rem] font-bold tracking-[-0.04em]">{restricted ? "Área restrita" : "Entrar"}</h1>
      <p className="mt-1.5 text-ink-soft">{restricted ? "Acesso da equipe do FinanceZap." : "Bom te ver de novo."}</p>
      <div className="mt-7">
        <ActionForm action={loginAction}>
          {back && <input type="hidden" name="back" value={back} />}
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" name="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span>Senha</span>
            <PasswordInput className="input" name="password" autoComplete="current-password" required />
          </label>
          <Submit pendingText="Entrando…" className="btn btn-primary mt-1 w-full">Entrar</Submit>
        </ActionForm>
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Ainda não tem conta? <Link href="/cadastro" className="font-semibold text-gain underline-offset-2 hover:underline">Criar conta</Link>
      </p>
    </>
  );
}
