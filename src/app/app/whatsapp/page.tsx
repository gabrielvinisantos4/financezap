import { appContext } from "@/server/app-context";
import { getLinkedNumber } from "@/server/whatsapp/linking";
import { getEntitlement } from "@/server/billing/entitlements";
import Link from "next/link";
import { env, integrations } from "@/server/config/env";
import { PageHeader, Panel } from "@/components/ui";
import { LinkWhatsapp } from "@/components/link-whatsapp";
import { ConfirmButton } from "@/components/forms";
import { unlinkWhatsappAction } from "@/app/actions/app";
import { HELP_TEXT } from "@/server/agent/format";

export const metadata = { title: "WhatsApp" };

function formatPhone(waId: string) {
  const d = waId.replace(/^55/, "");
  return d.length >= 10 ? `+55 (${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : `+${waId}`;
}

export default async function WhatsappPage() {
  const { user } = await appContext();
  const [linked, ent] = await Promise.all([getLinkedNumber(user.id), getEntitlement(user.id)]);
  return (
    <>
      <PageHeader title="WhatsApp" description="Vincule o número que vai conversar com o assistente." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title={linked ? "Número vinculado" : "Vincular meu WhatsApp"}>
          {!integrations.whatsappConfigured() ? (
            <div className="grid gap-4 text-sm text-ink-soft">
              <p className="rounded-xl bg-coin-soft px-4 py-3 text-ink">
                O número oficial do FinanceZap no WhatsApp ainda não foi ativado. Por enquanto não há para onde enviar o código de vínculo.
              </p>
              <p>Enquanto isso, você pode testar o assistente pelo simulador: ele funciona igual à conversa no WhatsApp e grava os lançamentos na sua conta.</p>
              {env().SIMULATOR_ENABLED && <Link href="/app/simulador" className="btn btn-primary w-fit">Abrir o simulador</Link>}
            </div>
          ) : linked ? (
            <div className="grid gap-4">
              <p className="wide text-2xl">{formatPhone(linked)}</p>
              <p className="text-sm text-ink-soft">
                {ent.active ? "Tudo pronto. Mande uma mensagem para o FinanceZap quando quiser." : "O número está vinculado, mas o assistente está pausado até a assinatura ficar ativa."}
              </p>
              <form action={unlinkWhatsappAction}>
                <ConfirmButton message="Desvincular este número? O assistente deixa de responder a ele.">Desvincular número</ConfirmButton>
              </form>
              <p className="text-sm text-ink-soft">Para trocar de número, gere um novo código abaixo e envie do número novo.</p>
              <LinkWhatsapp hasBusinessNumber={Boolean(env().WHATSAPP_BUSINESS_NUMBER)} />
            </div>
          ) : (
            <ol className="grid gap-4">
              <li>1. Gere um código de uso único.</li>
              <li>2. Envie o código do seu WhatsApp para o número do FinanceZap.</li>
              <li>3. Você recebe uma confirmação e já pode começar.</li>
              <li className="pt-2"><LinkWhatsapp hasBusinessNumber={Boolean(env().WHATSAPP_BUSINESS_NUMBER)} /></li>
            </ol>
          )}
        </Panel>
        <Panel title="O que mandar">
          <pre className="whitespace-pre-wrap font-sans text-sm text-ink-soft">{HELP_TEXT}</pre>
        </Panel>
      </div>
    </>
  );
}
