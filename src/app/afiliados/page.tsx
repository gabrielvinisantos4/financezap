import Link from "next/link";
import "../landing.css";
import { Reveal } from "@/components/landing/reveal";
import { LogoBars } from "@/components/landing/phone";
import { Arrow } from "@/components/landing/pricing";
import { ThemeToggle } from "@/components/theme";
import { env } from "@/server/config/env";
import { listActivePlans } from "@/server/billing/subscriptions";
import { currentUser } from "@/server/auth/session";
import { COMPANY } from "@/server/config/company";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Programa de afiliados",
  description: "Indique o FinanceZap e ganhe uma parte de cada mensalidade, todo mês, direto na sua conta do Asaas.",
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function AffiliateLanding() {
  const pct = env().AFFILIATE_COMMISSION_PCT;
  const [plans, user] = await Promise.all([listActivePlans().catch(() => []), currentUser().catch(() => null)]);
  const paid = plans.filter((p) => p.priceMonthlyCents > 0).sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents);
  const perClient = paid[0] ? Math.round(paid[0].priceMonthlyCents * 0.95 * (pct / 100)) : 0;
  const join = user ? "/app/afiliados" : "/cadastro?afiliado=1";

  const steps = [
    { n: 1, title: "Crie sua conta", text: "Grátis e sem precisar assinar." },
    { n: 2, title: "Pegue seu link", text: "Ex.: agentefinancezap.com.br/r/seu-nome" },
    { n: 3, title: "Receba todo mês", text: `${pct}% de cada mensalidade, no Asaas ou por Pix.` },
  ];
  const faq = [
    { q: "Preciso ser assinante para ser afiliado?", a: "Não. Qualquer pessoa pode criar a conta e pegar o link." },
    { q: "Como eu recebo?", a: "Você escolhe. Com conta no Asaas, a sua parte é separada automaticamente a cada mensalidade paga e cai na hora. Ou cadastre uma chave Pix de qualquer banco e receba tudo junto uma vez por mês." },
    { q: "Preciso ter conta no Asaas?", a: "Não. É só uma das opções (a mais rápida, porque cai a cada pagamento). Se preferir, cadastre sua chave Pix: o pagamento sai uma vez por mês, a partir de R$ 20." },
    { q: "Por quanto tempo eu ganho?", a: `Enquanto o seu indicado continuar pagando. É ${pct}% do valor líquido de cada mensalidade, todo mês.` },
    { q: "E se a pessoa só clicar e assinar depois?", a: "Quem abrir o seu link fica marcado por 60 dias. Se criar a conta nesse prazo, é seu indicado." },
    { q: "O que não pode?", a: "Indicar a si mesmo, criar contas falsas, fazer spam ou prometer o que o FinanceZap não faz. Isso suspende o afiliado." },
  ];

  return (
    <div className="fz">
      <Reveal />
      <header className="fz-nav">
        <div className="fz-nav-in glass">
          <Link href="/" className="fz-logo" aria-label="FinanceZap, página inicial">
            <span className="fz-logo-mark">
              <LogoBars />
            </span>
            FinanceZap
          </Link>
          <nav aria-label="Principal">
            <a href="#como-funciona">Como funciona</a>
            <a href="#ganhos">Quanto ganho</a>
            <a href="#perguntas">Perguntas</a>
          </nav>
          <div className="fz-nav-cta">
            <ThemeToggle />
            {!user && (
              <Link href="/entrar?voltar=/app/afiliados" className="fz-pill fz-pill-ghost">
                Entrar
              </Link>
            )}
            <Link href={join} className="fz-pill fz-pill-green fz-nav-main">
              Quero ser afiliado
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="fz-section fz-aff-hero" data-reveal>
          <header className="fz-head" data-r>
            <span className="fz-tag glass">Programa de afiliados</span>
            <h1>
              Indique o FinanceZap e ganhe <em>{pct}% todo mês.</em>
            </h1>
            <p>
              Cada pessoa que assinar pelo seu link gera comissão em todas as mensalidades, enquanto continuar assinante. Receba no Asaas ou por Pix em qualquer banco.
            </p>
            <div className="fz-actions">
              <Link href={join} className="fz-pill fz-pill-green fz-pill-lg">
                Pegar meu link
                <Arrow />
              </Link>
            </div>
          </header>
        </section>

        <section id="como-funciona" className="fz-section fz-how" data-reveal>
          <header className="fz-head" data-r>
            <h2>Como funciona</h2>
            <p>Três passos, sem burocracia.</p>
          </header>
          <ol className="fz-steps">
            {steps.map((s) => (
              <li key={s.n} className="fz-step glass" data-r>
                <span className="fz-step-n">{s.n}</span>
                <span>
                  <strong>{s.title}</strong>
                  <small>{s.text}</small>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {perClient > 0 && (
          <section id="ganhos" className="fz-section" data-reveal>
            <header className="fz-head" data-r>
              <h2>Quanto dá para ganhar</h2>
              <p>
                Conta aproximada no plano {paid[0].name} ({brl(paid[0].priceMonthlyCents)}/mês), já tirando a taxa do Asaas.
              </p>
            </header>
            <ol className="fz-steps fz-aff-earn">
              {[10, 50, 200].map((n) => (
                <li key={n} className="fz-step glass" data-r>
                  <span>
                    <small>{n} assinantes</small>
                    <strong className="fz-aff-value">{brl(perClient * n)}</strong>
                    <small>por mês, recorrente</small>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section id="perguntas" className="fz-section fz-faq" data-reveal>
          <header className="fz-head" data-r>
            <h2>Perguntas frequentes</h2>
          </header>
          <div className="fz-faq-list" data-r>
            {faq.map((f) => (
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

        <section className="fz-final-wrap" data-reveal>
          <div className="fz-final" data-r>
            <span className="fz-final-mark" aria-hidden="true">
              <LogoBars size={30} />
            </span>
            <h2>
              Seu link fica pronto <em>em 1 minuto.</em>
            </h2>
            <p>Crie a conta, escolha o seu código e comece a divulgar.</p>
            <Link href={join} className="fz-pill fz-pill-green fz-pill-lg">
              Quero ser afiliado
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
          <Link href="/">Início</Link>
          <Link href="/termos#afiliados">Regras do programa</Link>
          <Link href="/privacidade">Privacidade</Link>
        </nav>
        <span>© {new Date().getFullYear()} FinanceZap · CNPJ {COMPANY.cnpj}</span>
      </footer>
    </div>
  );
}
