import { COMPANY } from "@/server/config/company";

export const metadata = { title: "Termos de uso" };

export default function Terms() {
  return (
    <>
      <h1>Termos de uso</h1>
      <p>Versão 2026-11-11. Ao criar uma conta você concorda com estes termos.</p>
      <p>O FinanceZap é oferecido por {COMPANY.legalName}, CNPJ {COMPANY.cnpj}, com endereço em {COMPANY.address}. Contato: {COMPANY.email}.</p>

      <h2>O serviço</h2>
      <p>O FinanceZap é uma ferramenta de organização financeira pessoal: registra receitas e despesas que você informa pelo WhatsApp ou pelo painel e apresenta totais e relatórios calculados a partir desses registros.</p>

      <h2>O que o serviço não é</h2>
      <ul>
        <li>Não é banco, instituição de pagamento nem serviço de Open Finance; não movimenta dinheiro e não acessa suas contas bancárias.</li>
        <li>Não oferece recomendação de investimento, consultoria financeira, contábil ou tributária.</li>
        <li>Os saldos exibidos refletem apenas o que foi registrado e podem diferir do seu extrato.</li>
      </ul>

      <h2>Interpretação automática</h2>
      <p>As mensagens são interpretadas automaticamente e podem ser entendidas de forma incorreta. Confira as confirmações enviadas e corrija quando necessário. Alterações e exclusões pedem sua confirmação antes de serem aplicadas.</p>

      <h2>Assinatura e pagamento</h2>
      <ul>
        <li>O acesso depende de assinatura ativa. Valores, limites de uso e recursos de cada plano estão descritos na página de planos.</li>
        <li>Teste grátis: na primeira assinatura, você usa o serviço sem custo durante o período de teste informado na contratação. No cartão de crédito, o cartão é validado ao cadastrar e a primeira cobrança acontece somente no fim do teste. No Pix, nada é cobrado ao assinar: a primeira cobrança vence no último dia do teste e, se não for paga, o acesso é pausado no dia seguinte até o pagamento. Se cancelar antes, nada é cobrado. O teste é concedido uma única vez por cliente.</li>
        <li>Depois do teste (ou de imediato, no Pix), a cobrança é recorrente, mensal ou anual conforme o plano escolhido, até você cancelar.</li>
        <li>O acesso pago é liberado somente após a confirmação do pagamento pelo gateway (Asaas).</li>
        <li>Em caso de atraso, há uma tolerância de 5 dias antes da suspensão do assistente.</li>
        <li>Você pode cancelar a qualquer momento pelo painel; o acesso continua até o fim do período já pago e não há novas cobranças.</li>
        <li>Direito de arrependimento (art. 49 do Código de Defesa do Consumidor): você pode desistir em até 7 dias da primeira cobrança e receber o valor de volta integralmente. Basta pedir pelo e-mail {COMPANY.email}.</li>
      </ul>

      <h2>Uso adequado</h2>
      <p>É proibido usar o serviço para fins ilícitos, tentar acessar dados de outros clientes, sobrecarregar o sistema ou contornar limites do plano. Podemos suspender contas que violem estes termos.</p>

      <h2 id="afiliados">Programa de afiliados</h2>
      <ul>
        <li>Qualquer pessoa maior de idade pode se cadastrar como afiliado, mesmo sem ser assinante, e recebe um link próprio de indicação.</li>
        <li>Quem entra pelo link e cria conta em até 60 dias fica ligado ao afiliado. Vale o último link usado antes do cadastro.</li>
        <li>O afiliado recebe o percentual informado no painel de afiliados (hoje, 30%) sobre o valor líquido, já descontada a taxa do gateway, de cada mensalidade efetivamente paga pelo indicado, enquanto ele continuar assinante.</li>
        <li>O afiliado escolhe como recebe: (a) pela conta Asaas dele, com a comissão separada automaticamente (split) a cada pagamento; ou (b) por Pix em qualquer banco, uma vez por mês, reunindo as comissões com mais de 7 dias, a partir de R$ 20 (valores menores passam para o mês seguinte). Sem conta Asaas ou chave Pix cadastrada, não há como repassar a comissão; mensalidades pagas antes desse cadastro não geram comissão retroativa.</li>
        <li>Estornos, chargebacks e cancelamentos desfazem a comissão do pagamento correspondente. Se ela já tiver sido paga por Pix, o valor é descontado do repasse seguinte.</li>
        <li>Não é permitido indicar a si mesmo, criar contas falsas, fazer spam, prometer o que o serviço não faz ou anunciar usando a marca FinanceZap de forma enganosa. Nesses casos o afiliado pode ser suspenso e as comissões ligadas à fraude, canceladas.</li>
        <li>O percentual e as regras podem mudar para novas indicações, com aviso prévio no painel. O afiliado é responsável pelos tributos sobre o que recebe.</li>
      </ul>

      <h2>Disponibilidade</h2>
      <p>O serviço depende de terceiros (Meta/WhatsApp, provedores de IA, hospedagem e pagamentos) e pode ficar indisponível temporariamente. Trabalhamos para manter o serviço no ar e corrigir falhas com rapidez, mas não garantimos funcionamento ininterrupto. Como os valores exibidos vêm do que você registra, confira as informações antes de tomar decisões financeiras com base nelas.</p>

      <h2>Alterações e foro</h2>
      <p>Podemos atualizar estes termos; mudanças relevantes serão avisadas pelo painel ou por e-mail com antecedência. Fica eleito o foro do domicílio do consumidor, conforme o Código de Defesa do Consumidor.</p>

      <h2>Contato</h2>
      <p>{COMPANY.email}</p>
    </>
  );
}
