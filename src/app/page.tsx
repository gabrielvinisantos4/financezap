import Link from "next/link";
import { ChatDemo } from "@/components/chat-demo";
import { Logo } from "@/components/ui";
import { listActivePlans } from "@/server/billing/subscriptions";
import { formatBRL } from "@/server/finance/money";
import { currentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  { title: "Registrar", lines: ["Gastei 85 no mercado", "Paguei 120 de energia", "Comprei um fone de 300 em 3x no cartão", "Recebi 600 por um vídeo"] },
  { title: "Perguntar", lines: ["Quanto gastei hoje?", "Quanto gastei com combustível em outubro?", "Quanto tenho disponível?", "Quanto recebi de cada cliente?"] },
  { title: "Corrigir", lines: ["Errei o valor, era 70", "Não foi no posto, foi no mercado", "Apaga o último gasto", "Registrei duas vezes a mesma despesa"] },
];

const FAQ = [
  { q: "Preciso instalar algum aplicativo?", a: "Não. Você conversa pelo WhatsApp que já usa. O painel web é opcional e serve para ver gráficos, contas, cartões e relatórios." },
  { q: "O FinanceZap acessa minha conta bancária?", a: "Não. Ele só conhece o que você conta para ele. Não há conexão com bancos, cartões ou Open Finance — os saldos refletem o que foi registrado e o saldo inicial que você informar." },
  { q: "E se ele entender errado?", a: "Você corrige na hora, do seu jeito (\"errei, era 70\"). Alterações e exclusões sempre pedem sua confirmação antes, e quando a mensagem é ambígua ele pergunta em vez de chutar." },
  { q: "Quem faz as contas: a inteligência artificial?", a: "Não. A IA só interpreta o que você escreveu. Totais, saldos e relatórios são calculados pelo nosso sistema, direto no banco de dados." },
  { q: "Compras no cartão contam duas vezes quando pago a fatura?", a: "Não. A compra entra como despesa no dia em que foi feita; o pagamento da fatura é registrado como movimentação entre contas e não soma de novo." },
  { q: "Posso cancelar quando quiser?", a: "Sim, pelo painel. Você continua com acesso até o fim do período já pago e pode exportar ou excluir seus dados quando quiser." },
  { q: "Ele entende áudio e foto de comprovante?", a: "Por enquanto, só mensagens de texto." },
];

export default async function Home() {
  const [plans, user] = await Promise.all([listActivePlans().catch(() => []), currentUser().catch(() => null)]);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-2 text-sm" aria-label="Principal">
          <a href="#planos" className="hidden px-3 py-2 sm:inline">Planos</a>
          <a href="#seguranca" className="hidden px-3 py-2 sm:inline">Segurança</a>
          {user ? (
            <Link href={user.role === "user" ? "/app" : "/admin"} className="btn btn-primary">Abrir painel</Link>
          ) : (
            <>
              <Link href="/entrar" className="px-3 py-2 font-semibold">Entrar</Link>
              <Link href="/cadastro" className="btn btn-primary">Criar conta</Link>
            </>
          )}
        </nav>
      </header>

      <main>
        {/* Hero: a conversa é o produto */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
          <div>
            <h1 className="display text-[2.6rem] sm:text-6xl lg:text-[4.4rem]">Fale o gasto. A conta fecha sozinha.</h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Mande “gastei 50 no posto” no WhatsApp. O FinanceZap registra, coloca na categoria certa e responde quanto você gastou, recebeu e ainda tem — sem planilha e sem aplicativo novo.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/cadastro" className="btn btn-coin text-base">Começar agora</Link>
              <a href="#como-funciona" className="btn btn-ghost text-base">Ver como funciona</a>
            </div>
            <p className="mt-4 text-sm text-ink-faint">Funciona no WhatsApp que você já usa. Cancele quando quiser.</p>
          </div>
          <ChatDemo className="mx-auto w-full max-w-sm lg:max-w-md" />
        </section>

        {/* Como funciona: é de fato uma sequência */}
        <section id="como-funciona" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="display text-3xl sm:text-4xl">Três passos até a primeira anotação</h2>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {[
                ["Escolha um plano", "Crie sua conta e pague com Pix, boleto ou cartão. O acesso é liberado quando o pagamento é confirmado."],
                ["Vincule seu WhatsApp", "No painel, toque em “Vincular WhatsApp”. Um código de uso único confirma que o número é seu."],
                ["Converse", "Conte gastos e recebimentos como contaria a um amigo. Pergunte o que quiser sobre o seu dinheiro."],
              ].map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[auto_1fr] gap-4">
                  <span className="display grid h-11 w-11 place-items-center rounded-full bg-ink text-lg text-coin">{i + 1}</span>
                  <div>
                    <h3 className="wide text-lg">{t}</h3>
                    <p className="mt-1 text-ink-soft">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* O que ele entende */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="display max-w-2xl text-3xl sm:text-4xl">Escreva do seu jeito. Ele entende.</h2>
          <p className="mt-3 max-w-xl text-ink-soft">Sem comandos para decorar. Valores como “mil”, “1.200” ou “50,90”, datas como “ontem” e parcelas como “em 3x” funcionam naturalmente.</p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {EXAMPLES.map((g) => (
              <div key={g.title}>
                <h3 className="wide border-b-2 border-ink pb-2 text-lg">{g.title}</h3>
                <ul className="mt-3 grid gap-2">
                  {g.lines.map((l) => (
                    <li key={l} className="rounded-xl bg-surface px-3.5 py-2.5 text-[0.95rem] shadow-[inset_0_0_0_1px_var(--color-line)]">“{l}”</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* Painel */}
        <section className="bg-ink text-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="display text-3xl sm:text-4xl">E quando quiser ver o todo, tem o painel.</h2>
              <p className="mt-4 max-w-lg text-white/75">
                Gráficos por categoria, histórico com filtros, contas e cartões, contas a pagar e relatório do mês. O painel complementa a conversa — o dia a dia continua no WhatsApp.
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/15">
              {[
                ["Saldo das contas", "Separado do que já está comprometido com faturas e contas a pagar."],
                ["Cartões sem confusão", "A compra conta uma vez; o pagamento da fatura não duplica."],
                ["Parcelas e recorrências", "Parcelas futuras e contas fixas viram lembretes de contas a pagar."],
                ["Histórico completo", "Toda correção fica registrada, com o antes e o depois."],
              ].map(([t, d]) => (
                <div key={t} className="bg-ink p-5">
                  <dt className="wide text-coin">{t}</dt>
                  <dd className="mt-1 text-sm text-white/75">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Planos */}
        <section id="planos" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <h2 className="display text-3xl sm:text-4xl">Planos</h2>
          {plans.length === 0 ? (
            <p className="mt-4 max-w-xl text-ink-soft">Os planos estão sendo configurados. Crie sua conta para ser avisado quando as assinaturas abrirem.</p>
          ) : (
            <div className={`mt-10 grid gap-5 ${plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
              {plans.map((p, i) => {
                const featured = plans.length >= 3 && i === 1;
                return (
                  <article key={p.id} className={`flex flex-col rounded-2xl border p-6 ${featured ? "border-ink bg-ink text-white" : "border-line bg-surface"}`}>
                    <h3 className="wide text-xl">{p.name}</h3>
                    {p.description && <p className={`mt-1 text-sm ${featured ? "text-white/75" : "text-ink-soft"}`}>{p.description}</p>}
                    <p className="mt-5">
                      <span className="display money text-4xl">{formatBRL(p.priceMonthlyCents)}</span>
                      <span className={featured ? "text-white/70" : "text-ink-soft"}> /mês</span>
                    </p>
                    <p className={`text-sm ${featured ? "text-white/70" : "text-ink-faint"}`}>ou {formatBRL(p.priceYearlyCents)} por ano</p>
                    <ul className="mt-5 grid flex-1 gap-2 text-sm">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <span aria-hidden="true" className={featured ? "text-coin" : "text-gain"}>✓</span>
                          {f}
                        </li>
                      ))}
                      <li className={`flex gap-2 ${featured ? "text-white/70" : "text-ink-faint"}`}>
                        <span aria-hidden="true">·</span>Até {p.limits.monthlyMessages.toLocaleString("pt-BR")} mensagens por mês
                      </li>
                    </ul>
                    <Link href={`/cadastro?plano=${p.slug}`} className={`btn mt-6 ${featured ? "btn-coin" : "btn-primary"}`}>
                      Assinar o {p.name}
                    </Link>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Segurança e limites */}
        <section id="seguranca" className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="display text-3xl sm:text-4xl">Seus dados, só seus</h2>
              <ul className="mt-6 grid gap-4 text-ink-soft">
                <li><strong className="text-ink">Isolamento por cliente no banco de dados.</strong> Cada consulta só enxerga os lançamentos de quem está perguntando.</li>
                <li><strong className="text-ink">Integração oficial do WhatsApp.</strong> Usamos a plataforma oficial da Meta para empresas, não automações não autorizadas.</li>
                <li><strong className="text-ink">Mínimo necessário.</strong> O texto das suas mensagens é descartado após o processamento; ficam só os lançamentos.</li>
                <li><strong className="text-ink">Você no controle.</strong> Exporte tudo ou exclua sua conta pelo painel, quando quiser.</li>
                <li><strong className="text-ink">Pagamentos pelo Asaas.</strong> Não armazenamos dados de cartão.</li>
              </ul>
            </div>
            <div>
              <h2 className="display text-3xl sm:text-4xl">O que ele não faz</h2>
              <ul className="mt-6 grid gap-4 text-ink-soft">
                <li>Não se conecta ao seu banco nem lê extratos — registra o que você contar.</li>
                <li>Não faz pagamentos, transferências ou investimentos.</li>
                <li>Não dá recomendação de investimento nem substitui contador.</li>
                <li>Ainda não entende áudios nem fotos de comprovantes.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h2 className="display text-3xl sm:text-4xl">Perguntas frequentes</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {f.q}
                  <span aria-hidden="true" className="text-xl transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6">
          <div className="mx-auto max-w-6xl rounded-3xl bg-coin px-6 py-12 sm:px-12">
            <h2 className="display max-w-2xl text-3xl sm:text-5xl">A próxima despesa já pode ir direto pro WhatsApp.</h2>
            <Link href="/cadastro" className="btn btn-primary mt-8 text-base">Criar minha conta</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-ink-soft sm:px-6">
          <Logo />
          <nav className="flex gap-5" aria-label="Rodapé">
            <Link href="/termos">Termos de uso</Link>
            <Link href="/privacidade">Política de privacidade</Link>
          </nav>
          <p>© {new Date().getFullYear()} FinanceZap</p>
        </div>
      </footer>
    </div>
  );
}
