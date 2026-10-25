import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/forms";
import { loginAction } from "@/app/actions/auth";
import { currentUser } from "@/server/auth/session";

export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  const u = await currentUser();
  if (u) redirect(u.role === "user" ? "/app" : "/admin");
  return (
    <>
      <h1 className="display text-4xl">Entrar</h1>
      <div className="mt-8">
        <ActionForm action={loginAction}>
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" name="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span>Senha</span>
            <input className="input" type="password" name="password" autoComplete="current-password" required />
          </label>
          <Submit pendingText="Entrando…">Entrar</Submit>
        </ActionForm>
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Ainda não tem conta? <Link href="/cadastro" className="font-semibold text-ink underline">Criar conta</Link>
      </p>
    </>
  );
}
