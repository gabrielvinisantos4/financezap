import { appContext } from "@/server/app-context";
import { affiliateDashboard, getAffiliateByUser, listPayoutsForAffiliate, maskPixKey, pixBalance, suggestCode } from "@/server/affiliates/affiliates";
import { env } from "@/server/config/env";
import { listActivePlans } from "@/server/billing/subscriptions";
import { ActionForm, Submit } from "@/components/forms";
import { joinAffiliateAction, savePixAction, saveWalletAction } from "@/app/actions/affiliates";
import { PayoutTabs } from "@/components/payout-tabs";
import { Badge, Empty, Money, PageHeader, Panel, Stat } from "@/components/ui";
import { CopyLink } from "@/components/copy-link";

export const metadata = { title: "Afiliados" };

const STATUS: Record<string, { label: string; tone: "gain" | "coin" | "neutral" | "loss" }> = {
  assinante: { label: "Assinante", tone: "gain" },
  iniciou: { label: "No teste / iniciando", tone: "coin" },
  cadastrado: { label: "Só cadastrou", tone: "neutral" },
  cancelou: { label: "Cancelou", tone: "loss" },
};

export default async function AffiliatesPage() {
  const { user } = await appContext();
  const [aff, plans] = await Promise.all([getAffiliateByUser(user.id), listActivePlans().catch(() => [])]);
  const pct = aff ? aff.commissionBps / 100 : env().AFFILIATE_COMMISSION_PCT;
  const cheapest = plans.filter((p) => p.priceMonthlyCents > 0).sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents)[0];
  const example = cheapest ? Math.round(cheapest.priceMonthlyCents * 0.95 * (pct / 100)) : null; // ~5% de taxa do Asaas

  if (!aff) {
    const suggestion = await suggestCode(user.name);
    return (
      <>
        <PageHeader title="Seja afiliado" description={`Indique o FinanceZap e ganhe ${pct}% de cada mensalidade paga pelos seus indicados, todo mês, enquanto eles continuarem assinantes.`} />
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <Panel title="Como funciona">
            <ol className="grid gap-4 text-ink-soft">
              <li><b className="text-ink">1. Pegue seu link.</b> Ele fica assim: agentefinancezap.com.br/r/seu-codigo</li>
              <li><b className="text-ink">2. Divulgue.</b> Quem entrar pelo seu link e assinar em até {60} dias fica ligado a você.</li>
              <li><b className="text-ink">3. Receba todo mês.</b> O Asaas separa sua parte na hora do pagamento e manda direto para a sua conta. Não depende de ninguém transferir.</li>
            </ol>
            {example && cheapest && (
              <p className="mt-5 rounded-[16px] bg-gain-soft px-4 py-3 text-sm text-ink">
                Exemplo: no plano {cheapest.name}, cada indicado rende por volta de <b><Money cents={example} /></b> por mês para você. Com 50 indicados, cerca de <b><Money cents={example * 50} /></b> todo mês.
              </p>
            )}
          </Panel>
          <Panel title="Ativar meu link">
            <ActionForm action={joinAffiliateAction}>
              <label className="field">
                <span>Seu código no link</span>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-sm text-ink-faint">/r/</span>
                  <input className="input" name="code" defaultValue={suggestion} minLength={3} maxLength={24} pattern="[a-zA-Z0-9-]+" required />
                </div>
                <small className="text-ink-faint">Só letras sem acento, números e hífen. Ex.: maria, joao-silva.</small>
              </label>
              <label className="flex items-start gap-3 text-sm text-ink-soft">
                <input type="checkbox" name="accept" className="mt-1 h-4 w-4 accent-[var(--color-gain)]" required />
                <span>
                  Li e aceito as <a href="/termos#afiliados" target="_blank" className="font-semibold text-gain underline-offset-2 hover:underline">regras do programa de afiliados</a>.
                </span>
              </label>
              <Submit pendingText="Ativando…" className="btn btn-primary w-full">Ativar meu link de afiliado</Submit>
            </ActionForm>
          </Panel>
        </div>
      </>
    );
  }

  const [d, bal, payouts] = await Promise.all([affiliateDashboard(aff), pixBalance(aff.id), listPayoutsForAffiliate(aff.id)]);
  const usesPix = aff.payoutMethod === "pix";
  const ready = usesPix ? Boolean(aff.pixKey) : Boolean(aff.walletId);
  const minPix = env().AFFILIATE_PIX_MIN_CENTS;
  const PAYOUT_LABEL = { awaiting_approval: "Em preparação", processing: "Enviando", paid: "Pago", failed: "Falhou (volta no próximo)", canceled: "Cancelado" } as const;
  const url = `${env().APP_URL.replace(/\/$/, "")}/r/${aff.code}`;
  return (
    <>
      <PageHeader title="Afiliados" description={`Você ganha ${pct}% do valor líquido de cada mensalidade paga pelos seus indicados, enquanto eles forem assinantes.`} />

      {aff.status === "blocked" && (
        <p className="mb-6 rounded-[16px] bg-loss-soft px-4 py-3 text-sm text-ink">Seu link de afiliado está suspenso{aff.blockedReason ? `: ${aff.blockedReason}` : "."} Fale com {`contato@agentefinancezap.com.br`}.</p>
      )}
      {!ready && aff.status === "active" && (
        <p className="mb-6 rounded-[16px] bg-coin-soft px-4 py-3 text-sm text-ink">
          <b>Falta dizer onde você quer receber.</b> Cadastre sua conta Asaas ou uma chave Pix em “Onde você recebe”. Quem assinar antes passa a gerar comissão assim que você cadastrar.
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="users" label="Cliques no link">{d.clicks}</Stat>
        <Stat icon="user" label="Cadastros">{d.signups}</Stat>
        <Stat icon="star" label="Assinantes ativos">{d.paying}</Stat>
        <Stat icon="cash" label="Comissões no mês" hint={`Total: ${(d.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}>
          <Money cents={d.monthCents} />
        </Stat>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Seu link">
          <CopyLink url={url} shareText="Conheci o FinanceZap, um assistente que organiza suas finanças pelo WhatsApp. Dá para testar grátis:" />
          <p className="mt-4 text-sm text-ink-soft">Quem abrir esse link e criar conta em até 60 dias fica ligado a você. A comissão vale para todas as mensalidades pagas enquanto a pessoa for assinante.</p>
        </Panel>

        <Panel title="Onde você recebe">
          <div className="grid gap-4 text-sm text-ink-soft">
            <p>
              {usesPix
                ? aff.pixKey
                  ? <>Agora: <b className="text-ink">Pix</b> na chave {maskPixKey(aff.pixKeyType, aff.pixKey)}. O pagamento sai uma vez por mês, a partir de <Money cents={minPix} />.</>
                  : "Escolha como quer receber."
                : aff.walletId
                  ? <>Agora: <b className="text-ink">conta Asaas</b> (carteira {aff.walletId.slice(0, 8)}…{aff.walletId.slice(-4)}). Sua parte cai na hora de cada pagamento.</>
                  : "Escolha como quer receber."}
            </p>
            <PayoutTabs
              initial={usesPix ? "pix" : "asaas"}
              asaas={
                <div className="grid gap-3">
                  <ol className="grid gap-1.5">
                    <li>1. Crie uma conta grátis no <a href="https://www.asaas.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-gain underline-offset-2 hover:underline">Asaas</a> (pode ser pessoa física).</li>
                    <li>2. Abra <b className="text-ink">Integrações</b> e copie o <b className="text-ink">Wallet ID</b>.</li>
                    <li>3. Cole aqui. Se quiser, no Asaas você liga o saque automático para o seu banco.</li>
                  </ol>
                  <ActionForm action={saveWalletAction}>
                    <label className="field">
                      <span>Wallet ID do Asaas</span>
                      <input className="input font-mono" name="walletId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" required />
                    </label>
                    <Submit pendingText="Salvando…" className="btn btn-primary w-fit">Receber pelo Asaas</Submit>
                  </ActionForm>
                </div>
              }
              pix={
                <div className="grid gap-3">
                  <p>Sem precisar de conta no Asaas. As comissões se juntam e, uma vez por mês, mandamos um Pix para a sua chave (mínimo de <Money cents={minPix} />; o que faltar passa para o mês seguinte).</p>
                  <ActionForm action={savePixAction}>
                    <label className="field">
                      <span>Tipo de chave</span>
                      <select className="input" name="type" defaultValue={aff.pixKeyType ?? "CPF"}>
                        <option value="CPF">CPF</option>
                        <option value="CNPJ">CNPJ</option>
                        <option value="EMAIL">E-mail</option>
                        <option value="PHONE">Celular</option>
                        <option value="EVP">Chave aleatória</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Chave Pix</span>
                      <input className="input" name="key" autoComplete="off" required />
                    </label>
                    <Submit pendingText="Salvando…" className="btn btn-primary w-fit">Receber por Pix</Submit>
                  </ActionForm>
                </div>
              }
            />
            {usesPix && (
              <div className="grid gap-2 rounded-[16px] bg-paper px-4 py-3">
                <p>Disponível para o próximo Pix: <b className="text-ink"><Money cents={Math.max(bal.payableCents, 0)} /></b></p>
                {bal.pendingCents > 0 && <p>Em carência (libera {env().AFFILIATE_PIX_HOLD_DAYS} dias após o pagamento do cliente): <Money cents={bal.pendingCents} /></p>}
                {payouts.length > 0 && (
                  <ul className="mt-1 divide-y divide-line">
                    {payouts.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                        <span>{p.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {PAYOUT_LABEL[p.status]}</span>
                        <b className="text-ink"><Money cents={p.amountCents} /></b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Seus indicados">
          {d.referrals.length === 0 ? (
            <Empty title="Ninguém ainda">Compartilhe seu link para começar.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.referrals.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <b>{r.firstName}</b>
                    <small className="block text-ink-faint">desde {r.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small>
                  </span>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Comissões">
          {d.commissions.length === 0 ? (
            <Empty title="Nenhuma comissão ainda">Ela aparece aqui quando um indicado pagar a mensalidade.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.commissions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    {c.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    <small className="block text-ink-faint">sobre <Money cents={c.netCents} /> líquidos</small>
                  </span>
                  <span className={c.status === "reversed" ? "text-ink-faint line-through" : "font-semibold text-gain"}>
                    <Money cents={c.commissionCents} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-ink-faint">Valores calculados sobre o valor líquido (depois da taxa do Asaas). Estornos e chargebacks cancelam a comissão daquele pagamento; se ela já tiver sido paga por Pix, o valor é descontado no próximo repasse.</p>
        </Panel>
      </div>
    </>
  );
}
