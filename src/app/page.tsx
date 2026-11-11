import Link from "next/link";
import "./landing.css";
import { listActivePlans } from "@/server/billing/subscriptions";
import { currentUser } from "@/server/auth/session";
import { Reveal } from "@/components/landing/reveal";
import { LogoBars, Phone } from "@/components/landing/phone";
import { Dashboard, Icon, LIMITS, Ring } from "@/components/landing/dashboard";
import { Ways } from "@/components/landing/ways";
import { Arrow, Pricing } from "@/components/landing/pricing";
import { SiteNav } from "@/components/landing/site-nav";
import { env } from "@/server/config/env";
import { COMPANY } from "@/server/config/company";

export const dynamic = "force-dynamic";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const FAQ = [
  { q: "Preciso instalar algum aplicativo?", a: "Não. Você conversa pelo WhatsApp que já usa. O painel na web é opcional, para ver gráficos, limites e relatórios." },
  { q: "Ele acessa minha conta bancária?", a: "Não. Ele só sabe o que você conta, fala ou encaminha. Nada de senha de banco." },
  { q: "Entende áudio e comprovante?", a: "Sim. Mande um áudio, o print do Pix, a foto da nota ou o PDF. Se não tiver certeza se foi gasto ou recebimento, ele pergunta antes de registrar." },
  { q: "E se ele entender errado?", a: "Você corrige do seu jeito, como “errei, era 70”. Correções e exclusões pedem sua confirmação antes." },
  { q: "Como funcionam os limites?", a: "Você define quanto quer gastar por categoria ou no mês. Ao chegar em 80% e em 100%, o aviso vem junto da resposta, uma vez só." },
  { q: "E as contas fixas?", a: "Cadastre aluguel, luz ou internet com o valor e o dia. No vencimento chega um lembrete; responda “paguei” e ele dá baixa sem lançar em dobro." },
  { q: "Quem faz as contas, a inteligência artificial?", a: "Não. A IA só entende o que você escreveu. Totais, saldos e relatórios são calculados direto no banco de dados." },
  { q: "Como funciona o teste grátis?", a: "Você cadastra o cartão e usa tudo de graça durante o teste. A primeira cobrança só acontece no fim dele. Se cancelar antes pelo painel, não paga nada." },
  { q: "Posso cancelar quando quiser?", a: "Sim, pelo painel. O acesso continua até o fim do período pago, e você pode exportar ou excluir seus dados." },
];

const STEPS = [
  { n: 1, icon: "user", title: "Crie sua conta", text: "Cadastro rápido. Teste grátis com cartão." },
  { n: 2, icon: "chat", title: "Conecte seu WhatsApp", text: "Mande o código do painel e pronto." },
  { n: 3, icon: "bars", title: "Comece a usar", text: "Escreva, fale ou envie comprovantes." },
] as const;

function StepIcon({ name }: { name: "user" | "chat" | "bars" }) {
  if (name === "bars") return <Icon name="bars" size={22} />;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === "user" ? (
        <>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </>
      ) : (
        <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8z" />
      )}
    </svg>
  );
}

const LIMIT_ICON = { fork: "fork", car: "car", bag: "bag" } as const;

export default async function Home() {
  const [plans, user] = await Promise.all([listActivePlans().catch(() => []), currentUser().catch(() => null)]);
  const panelHref = user ? (user.role === "user" ? "/app" : "/admin") : null;
  const trial = env().CARD_TRIAL_DAYS;
  const cta = trial > 0 ? `Testar ${trial} dias grátis` : "Começar agora";
  const pricing = plans.slice(0, 3).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    monthly: p.priceMonthlyCents,
    yearly: p.priceYearlyCents,
    features: p.features,
    messages: p.limits.monthlyMessages,
  }));

  return (
    <div className="fz">
      <Reveal />

      <SiteNav links={[{ href: "#como-funciona", label: "Como funciona" }, { href: "#recursos", label: "Recursos" }, { href: "#planos", label: "Planos" }, { href: "#perguntas", label: "Perguntas" }, { href: "/afiliados", label: "Seja afiliado" }]} panelHref={panelHref} cta={{ href: "/cadastro", label: "Criar conta" }} />

      <main>
        {/* HERO */}
        <section className="fz-hero" data-reveal>
          <div className="fz-hero-copy">
            <span className="fz-tag glass" data-r>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4 20l1.3-3.9A8 8 0 1 1 8 18.8z" />
              </svg>
              Seu assistente financeiro no WhatsApp
            </span>
            <h1 data-r>
              Suas finanças,
              <br />
              do jeito <em>mais simples.</em>
            </h1>
            <p className="fz-lead" data-r>
              Fale com o FinanceZap pelo WhatsApp. Registre gastos, acompanhe seu dinheiro e receba lembretes, sem planilhas nem aplicativos complicados.
            </p>
            <div className="fz-actions" data-r>
              <Link href="/cadastro" className="fz-pill fz-pill-green fz-pill-lg">
                {cta}
                <Arrow />
              </Link>
              <a href="#como-funciona" className="fz-pill fz-pill-ghost fz-pill-lg">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
                </svg>
                Ver como funciona
              </a>
            </div>
            <ul className="fz-trust" data-r>
              <li>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />
                </svg>
                Responde em segundos
              </li>
              <li>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6z" />
                  <path d="m9 12 2 2 4-4" strokeLinecap="round" />
                </svg>
                Dados protegidos
              </li>
              <li>
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <rect x="7" y="3" width="10" height="18" rx="2.5" />
                  <path d="M11 17.5h2" strokeLinecap="round" />
                </svg>
                Funciona no WhatsApp
              </li>
            </ul>
          </div>

          <div className="fz-hero-visual" data-r>
            <div className="fz-glow" aria-hidden="true" />
            <Phone interactive autoplay />
            <div className="fz-float fz-f1 glass" aria-hidden="true">
              <span className="fz-float-icon">
                <svg viewBox="0 0 16 16" width="16" height="16">
                  <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span>
                <small>Despesa registrada</small>
                <strong>R$ 50,00</strong>
              </span>
            </div>
            <div className="fz-float fz-f2 glass" aria-hidden="true">
              <span className="fz-ring-wrap">
                <Ring pct={86} size={46} stroke={5} color="#f59e0b" />
              </span>
              <span>
                <small>Limite de Mercado</small>
                <strong>86%</strong>
              </span>
            </div>
            <div className="fz-float fz-f3 glass" aria-hidden="true">
              <span className="fz-float-icon is-amber">
                <Icon name="calendar" size={16} />
              </span>
              <span>
                <small>Vence hoje</small>
                <strong>Aluguel</strong>
              </span>
            </div>
            <div className="fz-float fz-f4 glass" aria-hidden="true">
              <small>Gastos do mês</small>
              <strong className="fz-float-big">R$ 2.031,55</strong>
              <span className="fz-spark">
                {[30, 44, 38, 56, 50, 68, 62].map((h, i) => (
                  <i key={i} style={{ height: `${h}%` }} />
                ))}
              </span>
            </div>
          </div>
        </section>

        {/* COMO FUNCIONA */}
        <section id="como-funciona" className="fz-section fz-how" data-reveal>
          <header className="fz-head" data-r>
            <h2>Como funciona</h2>
            <p>Comece a usar em menos de 2 minutos.</p>
          </header>
          <ol className="fz-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="fz-step glass" data-r>
                <span className="fz-step-n">{s.n}</span>
                <span className="fz-step-icon">
                  <StepIcon name={s.icon} />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.text}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* PAINEL */}
        <section id="recursos" className="fz-section fz-dash-sec" data-reveal>
          <header className="fz-head" data-r>
            <h2>Tudo o que você conta, organizado.</h2>
            <p>Cada mensagem vira um lançamento no seu painel, com gráficos, limites e histórico.</p>
          </header>
          <div className="fz-dash-wrap" data-r>
            <Dashboard />
          </div>
        </section>

        {/* JEITOS + LIMITES */}
        <section className="fz-section fz-duo" data-reveal>
          <div className="fz-duo-col" data-r>
            <header className="fz-head fz-head-left">
              <h2>Funciona do seu jeito.</h2>
              <p>Registre seus gastos da forma mais prática para você.</p>
            </header>
            <Ways />
          </div>
          <div className="fz-duo-col" data-r>
            <header className="fz-head fz-head-left">
              <h2>Limites que avisam.</h2>
              <p>Defina quanto quer gastar por categoria. O aviso chega em 80% e em 100%.</p>
            </header>
            <ul className="fz-limits">
              {LIMITS.map((l) => {
                const pct = Math.floor((l.spent * 100) / l.limit);
                return (
                  <li key={l.name} className="fz-limit glass">
                    <span className="fz-ring-wrap fz-ring-lg">
                      <Ring pct={pct} size={76} stroke={6} color={pct >= 80 ? "#f59e0b" : "var(--green)"} />
                      <span className="fz-ring-ic">
                        <Icon name={LIMIT_ICON[l.icon]} size={20} />
                      </span>
                    </span>
                    <span className="fz-limit-name">{l.name}</span>
                    <strong>{pct}%</strong>
                    <small>
                      {brl(l.spent)} de {brl(l.limit)}
                    </small>
                  </li>
                );
              })}
            </ul>
            <div className="fz-remind glass">
              <span className="fz-float-icon is-amber">
                <Icon name="calendar" size={18} />
              </span>
              <span>
                <strong>Contas fixas no dia certo</strong>
                <small>Aluguel, luz e internet com lembrete no vencimento. Responda “paguei” e ele dá baixa.</small>
              </span>
            </div>
          </div>
        </section>

        {/* PLANOS */}
        <section id="planos" className="fz-section fz-pricing" data-reveal>
          <header className="fz-head" data-r>
            <h2>Planos para o seu momento.</h2>
            <p>{trial > 0 ? `Teste grátis por ${trial} dias. A primeira cobrança só vem depois, e você cancela quando quiser.` : "Escolha o plano ideal e comece hoje mesmo. Cancele quando quiser."}</p>
          </header>
          {pricing.length ? (
            <Pricing plans={pricing} trialDays={trial} />
          ) : (
            <p className="fz-lead fz-center">Os planos estão sendo configurados. Crie sua conta para ser avisado quando as assinaturas abrirem.</p>
          )}
        </section>

        {/* PERGUNTAS */}
        <section id="perguntas" className="fz-section fz-faq" data-reveal>
          <header className="fz-head" data-r>
            <h2>Perguntas frequentes</h2>
          </header>
          <div className="fz-faq-list" data-r>
            {FAQ.map((f) => (
              <details key={f.q} className="fz-q glass">
                <summary>
                  {f.q}
                  <span className="fz-plus" aria-hidden="true" />
                </summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CHAMADA FINAL */}
        <section className="fz-final-wrap" data-reveal>
          <div className="fz-final" data-r>
            <span className="fz-final-mark" aria-hidden="true">
              <LogoBars size={30} />
            </span>
            <h2>
              Comece a cuidar melhor <em>do seu dinheiro.</em>
            </h2>
            <p>Crie sua conta, conecte seu WhatsApp e registre seu primeiro gasto em poucos minutos.</p>
            <Link href="/cadastro" className="fz-pill fz-pill-green fz-pill-lg">
              {cta}
              <Arrow />
            </Link>
          </div>
        </section>
      </main>

      <footer className="fz-foot">
        <span className="fz-logo">
          <span className="fz-logo-mark">
            <LogoBars />
          </span>
          FinanceZap
        </span>
        <nav aria-label="Rodapé">
          <Link href="/termos">Termos de uso</Link>
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/entrar?voltar=/admin">Área restrita</Link>
          <Link href="/afiliados">Seja afiliado</Link>
          <Link href="/entrar">Entrar</Link>
        </nav>
        <span>© {new Date().getFullYear()} FinanceZap · {COMPANY.legalName.replace(/^[\d.]+ /, "")} · CNPJ {COMPANY.cnpj}</span>
      </footer>
    </div>
  );
}
