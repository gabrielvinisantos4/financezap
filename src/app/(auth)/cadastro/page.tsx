import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/forms";
import { signupAction } from "@/app/actions/auth";
import { currentUser } from "@/server/auth/session";

export const metadata = { title: "Criar conta" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plano?: string }> }) {
  if (await currentUser()) redirect("/app");
  const { plano } = await searchParams;
  return (
    <>
      <h1 className="display text-4xl">Criar conta</h1>
      <p className="mt-2 text-ink-soft">Depois você escolhe o plano e vincula seu WhatsApp.</p>
      <div className="mt-8">
        <ActionForm action={signupAction}>
          <input type="hidden" name="plan" value={plano ?? ""} />
          <label className="field">
            <span>Nome</span>
            <input className="input" name="name" autoComplete="name" required />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input className="input" type="email" name="email" autoComplete="email" required />
          </label>
          <label className="field">
            <span>WhatsApp (com DDD)</span>
            <input className="input" type="tel" name="phone" autoComplete="tel" inputMode="tel" placeholder="(44) 99999-9999" />
          </label>
          <label className="field">
            <span>Senha</span>
            <input className="input" type="password" name="password" autoComplete="new-password" minLength={10} required aria-describedby="pw-hint" />
            <small id="pw-hint" className="text-ink-faint">Pelo menos 10 caracteres, com letras e números.</small>
          </label>
          <label className="flex items-start gap-3 text-sm text-ink-soft">
            <input type="checkbox" name="acceptTerms" className="mt-1 h-4 w-4 accent-[#1b2a4a]" required />
            <span>
              Li e aceito os <Link href="/termos" className="underline" target="_blank">Termos de uso</Link> e a{" "}
              <Link href="/privacidade" className="underline" target="_blank">Política de privacidade</Link>.
            </span>
          </label>
          <Submit pendingText="Criando conta…">Criar conta</Submit>
        </ActionForm>
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Já tem conta? <Link href="/entrar" className="font-semibold text-ink underline">Entrar</Link>
      </p>
    </>
  );
}
