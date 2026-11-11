import { appContext } from "@/server/app-context";
import { PasswordInput } from "@/components/password-input";
import { PageHeader, Panel } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { deleteAccountAction, deleteAllEntriesAction, updateProfileAction } from "@/app/actions/app";
import { logoutAction } from "@/app/actions/auth";

export const metadata = { title: "Minha conta" };

const ZONES = ["America/Sao_Paulo", "America/Manaus", "America/Cuiaba", "America/Porto_Velho", "America/Boa_Vista", "America/Rio_Branco", "America/Belem", "America/Fortaleza", "America/Recife", "America/Noronha"];

export default async function AccountPage() {
  const { user } = await appContext();
  return (
    <>
      <PageHeader title="Minha conta" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Dados">
          <ActionForm action={updateProfileAction}>
            <label className="field">
              <span>Nome</span>
              <input className="input" name="name" defaultValue={user.name} required />
            </label>
            <label className="field">
              <span>E-mail</span>
              <input className="input bg-paper" value={user.email} readOnly aria-readonly="true" />
            </label>
            <label className="field">
              <span>Fuso horário</span>
              <select className="input" name="timezone" defaultValue={user.timezone}>
                {ZONES.map((z) => <option key={z} value={z}>{z.replace("America/", "").replace("_", " ")}</option>)}
              </select>
              <small className="text-ink-faint">Usado para entender “hoje” e “ontem” nas suas mensagens.</small>
            </label>
            <Submit className="btn btn-primary w-fit">Salvar dados</Submit>
          </ActionForm>
          <form action={logoutAction} className="mt-6 border-t border-line pt-4 lg:hidden">
            <button className="btn btn-ghost">Sair</button>
          </form>
        </Panel>
        <div className="grid content-start gap-6">
          <Panel title="Seus dados">
            <p className="text-sm text-ink-soft">Baixe tudo o que o FinanceZap guarda sobre você: perfil, consentimentos, assinatura, contas, categorias, lançamentos e histórico de alterações.</p>
            <a href="/app/conta/exportar" className="btn btn-ghost mt-4">Baixar meus dados (JSON)</a>
          </Panel>
          <section id="apagar-lancamentos" className="scroll-mt-24">
            <Panel title="Apagar lançamentos">
              <p className="text-sm text-ink-soft">
                Apaga de uma vez os gastos, os recebimentos ou tudo o que foi registrado, pelo WhatsApp ou pelo painel. Sua conta, a assinatura, o WhatsApp vinculado, as contas, categorias, limites e contas fixas continuam. Útil para começar do zero depois de testar.
              </p>
              <ActionForm action={deleteAllEntriesAction} className="mt-4 grid gap-3" resetOnSuccess>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-semibold text-ink-soft">O que apagar</legend>
                  <div className="grid grid-cols-3 gap-1 rounded-full bg-paper p-1 text-sm font-semibold">
                    {[
                      ["expense", "Gastos"],
                      ["income", "Recebimentos"],
                      ["all", "Tudo"],
                    ].map(([v, label]) => (
                      <label key={v} className="relative cursor-pointer rounded-full text-center text-ink-soft has-[:checked]:text-ink">
                        <input type="radio" name="scope" value={v} defaultChecked={v === "all"} className="peer sr-only" />
                        <span className="block rounded-full px-2 py-2 peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-[inset_0_1px_0_var(--lg-rim),inset_0_0_0_1px_var(--lg-hairline),0_8px_22px_-14px_var(--lg-drop)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gain">{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="field">
                  <span>Digite APAGAR para confirmar</span>
                  <input className="input" name="confirm" autoComplete="off" required />
                </label>
                <label className="field">
                  <span>Sua senha</span>
                  <PasswordInput className="input" name="password" autoComplete="current-password" required />
                </label>
                <Submit className="btn btn-danger w-fit" pendingText="Apagando…">
                  Apagar
                </Submit>
              </ActionForm>
            </Panel>
          </section>
          <Panel title="Excluir conta">
            <p className="text-sm text-ink-soft">
              Cancela a assinatura, desvincula o WhatsApp e apaga definitivamente seus lançamentos, contas e categorias. Registros de pagamento podem ser mantidos pelo prazo exigido em lei, sem seus dados pessoais. Esta ação não pode ser desfeita.
            </p>
            <ActionForm action={deleteAccountAction} className="mt-4 grid gap-3">
              <label className="field">
                <span>Digite EXCLUIR para confirmar</span>
                <input className="input" name="confirm" autoComplete="off" required />
              </label>
              <label className="field">
                <span>Sua senha</span>
                <PasswordInput className="input" name="password" autoComplete="current-password" required />
              </label>
              <Submit className="btn btn-danger w-fit" pendingText="Excluindo…">Excluir minha conta</Submit>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
