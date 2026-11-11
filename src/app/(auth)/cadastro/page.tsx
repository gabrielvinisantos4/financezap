import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/forms";
import { signupAction } from "@/app/actions/auth";
import { currentUser } from "@/server/auth/session";
import { SignupFields } from "@/components/signup-fields";

export const metadata = { title: "Criar conta" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plano?: string; afiliado?: string }> }) {
  const { plano, afiliado } = await searchParams;
  const asAffiliate = afiliado === "1";
  if (await currentUser()) redirect(asAffiliate ? "/app/afiliados" : "/app");
  return (
    <>
      <h1 className="text-[2rem] font-bold tracking-[-0.04em]">{asAffiliate ? "Seja afiliado" : "Criar conta"}</h1>
      <p className="mt-1.5 text-ink-soft">{asAffiliate ? "Crie sua conta para pegar seu link de indicação. Não precisa ser assinante." : "Depois você escolhe o plano e vincula seu WhatsApp."}</p>
      <div className="mt-7">
        <ActionForm action={signupAction}>
          <input type="hidden" name="plan" value={plano ?? ""} />
          {asAffiliate && <input type="hidden" name="affiliate" value="1" />}
          <SignupFields />
          <Submit pendingText="Criando conta…" className="btn btn-primary mt-1 w-full">{asAffiliate ? "Criar conta e pegar meu link" : "Criar conta"}</Submit>
        </ActionForm>
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        Já tem conta? <Link href={asAffiliate ? "/entrar?voltar=/app/afiliados" : "/entrar"} className="font-semibold text-gain underline-offset-2 hover:underline">Entrar</Link>
      </p>
    </>
  );
}
