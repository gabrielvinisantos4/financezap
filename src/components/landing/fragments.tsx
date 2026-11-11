/**
 * Pedaços reais da interface do FinanceZap, montados em HTML no tamanho de verdade
 * (rótulos e números que fecham). São as "fotos" do produto na página de vendas.
 */

// Textos que o robô realmente envia (com os emojis dele)
const T = {
  alert: "⚠️ Você já usou 86% do limite de Mercado. Restam R$ 97,75 até o fim do mês.", // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  remind: "⏰ Lembrete: hoje vence 🏠 Aluguel — R$ 1.200,00.", // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  paid: "✅ Conta fixa paga!\n🏠 Moradia · R$ 1.200,00\nDei baixa — não lancei em dobro.", // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  fix: "Vou corrigir:\n⛽ Combustível\n💰 R$ 50,00 → R$ 70,00\nConfirma?", // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  fixed: "✅ Lançamento corrigido!", // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function CheckoutFragment() {
  return (
    <div className="lp-frag lp-frag-light" data-ui aria-label="Tela de assinatura com escolha de Pix ou cartão">
      <p className="lp-frag-title">Plano Pro · R$ 29,90/mês</p>
      <div className="lp-pay">
        <span className="is-on">Pix</span>
        <span>Cartão de crédito</span>
      </div>
      <p className="lp-frag-note">O acesso é liberado assim que o pagamento é confirmado.</p>
    </div>
  );
}

export function LinkCodeFragment() {
  return (
    <div className="lp-frag lp-frag-light" data-ui aria-label="Código de vínculo do WhatsApp no painel">
      <p className="lp-frag-title">Vincular WhatsApp</p>
      <p className="lp-code">482913</p>
      <p className="lp-frag-note">Mande “Vincular 482913” para (44) 99188-7438. O código vale 10 minutos.</p>
    </div>
  );
}

const MONTH = [
  { icon: "🛒", name: "Mercado", c: 60225, color: "#2a78d6" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  { icon: "🧱", name: "Material de construção", c: 54000, color: "#eb6834" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  { icon: "⛽", name: "Combustível", c: 25000, color: "#1baf7a" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  { icon: "💡", name: "Água, luz e gás", c: 19830, color: "#eda100" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  { icon: "🍽️", name: "Restaurantes e lanches", c: 12450, color: "#e87ba4" }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
];
const OTHERS = 31650;

export function MonthFragment() {
  const total = MONTH.reduce((s, r) => s + r.c, 0) + OTHERS;
  return (
    <div className="lp-frag lp-frag-light" data-ui aria-label="Painel: onde foi o dinheiro no mês, por categoria">
      <p className="lp-frag-title">Onde foi o dinheiro em novembro</p>
      <p className="lp-frag-big">{brl(total)}</p>
      <div className="lp-seg" aria-hidden="true">
        {MONTH.map((r) => (
          <i key={r.name} style={{ width: `${(r.c / total) * 100}%`, background: r.color }} />
        ))}
        <i style={{ width: `${(OTHERS / total) * 100}%`, background: "#b4bccb" }} />
      </div>
      <ul className="lp-rows">
        {MONTH.slice(0, 4).map((r) => (
          <li key={r.name}>
            <span className="lp-dot" style={{ background: r.color }} />
            <span className="lp-row-name">
              {r.icon} {r.name}
            </span>
            <span className="lp-row-val">{brl(r.c)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BUDGETS = [
  { icon: "🛒", name: "Mercado", spent: 60225, limit: 70000 }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  { icon: "🍽️", name: "Restaurantes", spent: 7800, limit: 15000 }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
  { icon: "📊", name: "Total do mês", spent: 203155, limit: 300000 }, // taste-skill-ignore — emoji é a resposta real do robô no WhatsApp
];

export function BudgetFragment() {
  return (
    <div className="lp-frag lp-frag-light lp-frag-tall" data-ui aria-label="Limites do mês com barras de progresso e um aviso de 80%">
      <p className="lp-frag-title">Limites do mês</p>
      <ul className="lp-budgets">
        {BUDGETS.map((b) => {
          const pct = Math.floor((b.spent * 100) / b.limit);
          return (
            <li key={b.name}>
              <span className="lp-b-head">
                <span>
                  {b.icon} {b.name}
                </span>
                <span>{pct}%</span>
              </span>
              <span className="lp-bar">
                <i style={{ width: `${Math.min(pct, 100)}%`, background: pct >= 80 ? "#e2a336" : "#1e7a4c" }} />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="lp-alert">{T.alert}</p>
    </div>
  );
}

export function ReminderFragment() {
  return (
    <div className="lp-frag lp-frag-chat lp-frag-tall" data-ui aria-label="Lembrete de conta fixa no WhatsApp e a baixa com paguei">
      <p className="lp-mini is-bot">{T.remind}</p>
      <p className="lp-mini is-me">paguei o aluguel</p>
      <p className="lp-mini is-bot">{T.paid}</p>
    </div>
  );
}

export function CorrectionFragment() {
  return (
    <div className="lp-frag lp-frag-chat lp-frag-tall" data-ui aria-label="Correção de um lançamento pelo WhatsApp">
      <p className="lp-mini is-me">errei, o posto foi 70</p>
      <p className="lp-mini is-bot">{T.fix}</p>
      <p className="lp-mini is-me">sim</p>
      <p className="lp-mini is-bot">{T.fixed}</p>
    </div>
  );
}
