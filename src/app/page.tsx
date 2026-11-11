import Link from "next/link";
import "./landing.css";
import { listActivePlans } from "@/server/billing/subscriptions";
import { formatBRL } from "@/server/finance/money";
import { currentUser } from "@/server/auth/session";
import { Stage } from "@/components/landing/stage";
import { Reveal } from "@/components/landing/reveal";
import { BudgetFragment, CheckoutFragment, CorrectionFragment, LinkCodeFragment, MonthFragment, ReminderFragment } from "@/components/landing/fragments";

export const dynamic = "force-dynamic";

const FAQ = [
  { q: "Preciso instalar algum aplicativo?", a: "Não. Você conversa pelo WhatsApp que já usa. O painel na web é opcional, para ver gráficos, limites e relatórios." },
  { q: "Ele acessa minha conta bancária?", a: "Não. Ele só sabe o que você conta, fala ou encaminha. Nada de senha de banco." },
  { q: "Entende áudio e comprovante?", a: "Sim. Mande um áudio, o print do Pix, a foto da nota ou o PDF do comprovante. Se não tiver certeza se foi gasto ou recebimento, ele pergunta antes de registrar." },
  { q: "E se ele entender errado?", a: "Você corrige do seu jeito, como “errei, era 70”. Correções e exclusões pedem sua confirmação antes." },
  { q: "Quem faz as contas, a inteligência artificial?", a: "Não. A IA só entende o que você escreveu. Totais, saldos e relatórios são calculados direto no banco de dados." },
  { q: "Como funcionam os limites?", a: "Você define quanto quer gastar por categoria ou no mês. Ao chegar em 80% e em 100%, o aviso vem junto da resposta, uma vez só." },
  { q: "E as contas fixas?", a: "Cadastre aluguel, luz ou internet com o valor e o dia. No dia do vencimento chega um lembrete; responda “paguei” e ele dá baixa sem lançar em dobro." },
  { q: "Compra no cartão conta duas vezes quando pago a fatura?", a: "Não. A compra entra no dia em que foi feita; o pagamento da fatura é uma movimentação entre contas e não soma de novo." },
  { q: "Posso cancelar quando quiser?", a: "Sim, pelo painel. O acesso continua até o fim do período pago, e você pode exportar ou excluir seus dados." },
];

const TILE_HEIGHTS = ["lp-tile-1", "lp-tile-2", "lp-tile-3"];

export default async function Home() {
  const [plans, user] = await Promise.all([listActivePlans().catch(() => []), currentUser().catch(() => null)]);
  const panelHref = user ? (user.role === "user" ? "/app" : "/admin") : null;

  return (
    <div className="lp">
      <Reveal />

      <div className="lp-split">
        <div className="lp-read">
          <header className="lp-nav">
            <Link href="/" className="lp-word" aria-label="FinanceZap, página inicial">
              FinanceZap
            </Link>
            <nav aria-label="Principal">
              <a href="#como-comeca">Como começa</a>
              <a href="#planos">Planos</a>
              <a href="#perguntas">Perguntas</a>
              {panelHref ? <Link href={panelHref}>Abrir painel</Link> : <Link href="/entrar">Entrar</Link>}
            </nav>
          </header>

          <section className="lp-hero" data-scene="escrever" data-reveal>
            <h1 data-r>Fale o gasto. A conta fecha.</h1>
            <p className="lp-lead" data-r>
              Mande “gastei 50 no posto” no WhatsApp. O FinanceZap registra na categoria certa, avisa quando o limite aperta e lembra as contas do mês.
            </p>
            <div className="lp-actions" data-r>
              <Link href="/cadastro" className="lp-btn">
                Criar minha conta
              </Link>
              <a href="#planos" className="lp-link">
                Ver planos
              </a>
            </div>
            <p className="lp-note" data-r>
              Sem aplicativo novo e sem planilha. Cancele quando quiser.
            </p>
          </section>

          <section className="lp-ways" aria-labelledby="jeitos">
            <h2 id="jeitos" data-reveal>
              <span data-r>Escreva, fale ou encaminhe.</span>
            </h2>
            <div className="lp-way" data-scene="escrever" data-reveal>
              <p data-r>
                <strong>Escrevendo,</strong> do seu jeito: “paguei 120 de luz”, “recebi 1.200 de um cliente”, “comprei um fone de 300 em 3x”. Valores como “mil” e “50,90”, datas como “ontem” e
                parcelas entram certas.
              </p>
            </div>
            <div className="lp-way" data-scene="falar" data-reveal>
              <p data-r>
                <strong>Falando,</strong> quando as mãos estão ocupadas. Mande um áudio dizendo o gasto; ele mostra o que entendeu e registra.
              </p>
            </div>
            <div className="lp-way" data-scene="encaminhar" data-reveal>
              <p data-r>
                <strong>Encaminhando</strong> o comprovante do Pix direto do app do banco, a foto da nota ou o PDF. Ele lê valor, data e com quem foi, e pergunta antes se não tiver certeza.
              </p>
            </div>
          </section>

          <section id="como-comeca" className="lp-steps" aria-labelledby="comeca-t">
            <h2 id="comeca-t" data-reveal>
              <span data-r>Começa em dois minutos.</span>
            </h2>
            <div className="lp-step" data-scene="escrever" data-reveal>
              <p data-r>
                <strong>Para começar,</strong> crie sua conta e escolha um plano. Paga com Pix ou cartão, e o acesso é liberado assim que o pagamento é confirmado.
              </p>
              <div data-r>
                <CheckoutFragment />
              </div>
            </div>
            <div className="lp-step" data-scene="vincular" data-reveal>
              <p data-r>
                <strong>Logo depois,</strong> o painel mostra um código. Você manda “Vincular” e o código para o número do FinanceZap, e o seu WhatsApp fica ligado à sua conta.
              </p>
              <div data-r>
                <LinkCodeFragment />
              </div>
            </div>
            <div className="lp-step" data-scene="escrever" data-reveal>
              <p data-r>
                <strong>A partir daí,</strong> é conversar. No fim do mês, o painel mostra para onde foi cada real, comparado com o mês anterior.
              </p>
              <div data-r>
                <MonthFragment />
              </div>
            </div>
          </section>
        </div>

        <aside className="lp-stage-col" aria-label="Demonstração: conversa com o FinanceZap no WhatsApp">
          <Stage />
        </aside>
      </div>

      <section className="lp-features" aria-labelledby="resto">
        <div className="lp-features-grid">
          <h2 id="resto" className="lp-pinned">
            Ele cuida do resto.
          </h2>
          <div className="lp-blocks">
            <article className="lp-block" data-reveal>
              <h3 data-r>Limites que avisam</h3>
              <div className="lp-block-row">
                <div data-r>
                  <BudgetFragment />
                </div>
                <ul data-r>
                  <li>Por categoria ou para o mês inteiro</li>
                  <li>“limite de 800 para mercado” e pronto</li>
                  <li>Aviso em 80% e em 100%, uma vez só</li>
                  <li>Barra de progresso no painel</li>
                </ul>
              </div>
            </article>
            <article className="lp-block is-flip" data-reveal>
              <h3 data-r>Contas fixas no dia certo</h3>
              <div className="lp-block-row">
                <div data-r>
                  <ReminderFragment />
                </div>
                <ul data-r>
                  <li>Aluguel, luz, internet, salário</li>
                  <li>“meu aluguel é 1.200 todo dia 10”</li>
                  <li>Lembrete no dia do vencimento</li>
                  <li>“paguei” dá baixa, sem lançar em dobro</li>
                </ul>
              </div>
            </article>
            <article className="lp-block" data-reveal>
              <h3 data-r>Corrige do seu jeito</h3>
              <div className="lp-block-row">
                <div data-r>
                  <CorrectionFragment />
                </div>
                <ul data-r>
                  <li>“errei, era 70” corrige o último</li>
                  <li>“apaga o último gasto” exclui</li>
                  <li>Pede confirmação antes de mudar</li>
                  <li>Todo antes e depois fica no histórico</li>
                </ul>
              </div>
            </article>

          </div>
        </div>
      </section>

      <section className="lp-trust" aria-labelledby="dados" data-reveal>
        <h2 id="dados" data-r>
          Seus dados, só seus.
        </h2>
        <p data-r>
          Cada cliente só enxerga os próprios lançamentos, isolados no banco de dados. Usamos a integração oficial da Meta para o WhatsApp. O texto das mensagens é descartado depois de
          processado e ficam só os lançamentos. Pagamentos pelo Asaas, sem guardar dado de cartão. Exporte ou exclua tudo pelo painel, quando quiser.
        </p>
      </section>

      <section id="planos" className="lp-pricing" aria-labelledby="planos-t">
        <h2 id="planos-t" data-reveal>
          <span data-r>Escolha o tamanho.</span>
        </h2>
        {plans.length === 0 ? (
          <p className="lp-lead">Os planos estão sendo configurados. Crie sua conta para ser avisado quando as assinaturas abrirem.</p>
        ) : (
          <div className="lp-tiles" data-reveal>
            {plans.slice(0, 3).map((p, i) => (
              <article key={p.id} className={`lp-tile ${TILE_HEIGHTS[i] ?? "lp-tile-3"}`} data-r>
                <div className="lp-tile-body">
                  <h3>{p.name}</h3>
                  <p className="lp-price">
                    {formatBRL(p.priceMonthlyCents)}
                    <span>/mês</span>
                  </p>
                  <p className="lp-year">ou {formatBRL(p.priceYearlyCents)} por ano</p>
                  <ul>
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                    <li>Até {p.limits.monthlyMessages.toLocaleString("pt-BR")} mensagens por mês</li>
                  </ul>
                </div>
                <Link href={`/cadastro?plano=${p.slug}`} className="lp-tile-cta">
                  Assinar o {p.name}
                </Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="perguntas" className="lp-faq" aria-labelledby="faq-t" data-reveal>
        <h2 id="faq-t" data-r>
          Perguntas, respondidas.
        </h2>
        <div className="lp-faq-text" data-r>
          {FAQ.map((f) => (
            <p key={f.q}>
              <strong>{f.q}</strong> {f.a}
            </p>
          ))}
        </div>
      </section>

      <section className="lp-cta" data-reveal>
        <h2 data-r>Comece hoje.</h2>
        <p data-r>Crie a conta, vincule o WhatsApp e escreva o próximo gasto. Leva dois minutos.</p>
        <div className="lp-actions" data-r>
          <Link href="/cadastro" className="lp-btn">
            Criar minha conta
          </Link>
          <Link href="/entrar" className="lp-link">
            Já tenho conta
          </Link>
        </div>
      </section>

      <footer className="lp-foot">
        <span>Assistente financeiro no WhatsApp</span>
        <nav aria-label="Rodapé">
          <Link href="/termos">Termos de uso</Link>
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/entrar">Entrar</Link>
        </nav>
        <span>© {new Date().getFullYear()} FinanceZap</span>
      </footer>
    </div>
  );
}
