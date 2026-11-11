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
      <h1 className="text-[2rem] font-bold tracking-[-0.04em]">Criar conta</h1>
      <p className="mt-1.5 text-ink-soft">Depois você escolhe o plano e vincula seu WhatsApp.</p>
      <div className="mt-7">
        <ActionForm action={signupAction}>
          <input type="hidden" name="plan" value={plano ?? ""} />
          <SignupFields />
          <Submit pendingText="Criando conta…" className="btn btn-primary mt-1 w-full">Criar conta</Submit>
        </ActionForm>
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Já tem conta? <Link href="/entrar" className="font-semibold text-gain underline-offset-2 hover:underline">Entrar</Link>
      </p>
    </>
  );
}
