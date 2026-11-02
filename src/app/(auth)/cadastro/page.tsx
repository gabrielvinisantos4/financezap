import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/forms";
import { signupAction } from "@/app/actions/auth";
import { currentUser } from "@/server/auth/session";
import { SignupFields } from "@/components/signup-fields";

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
          <SignupFields />
          <Submit pendingText="Criando conta…">Criar conta</Submit>
        </ActionForm>
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Já tem conta? <Link href="/entrar" className="font-semibold text-ink underline">Entrar</Link>
      </p>
    </>
  );
}
