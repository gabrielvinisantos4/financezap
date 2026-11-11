export const metadata = { title: "Política de privacidade" };

export default function Privacy() {
  return (
    <>
      <h1>Política de privacidade</h1>
      <p>Versão 2026-10-24. Esta política explica quais dados o FinanceZap trata, para quê, com quem compartilha e como você exerce seus direitos previstos na Lei Geral de Proteção de Dados (Lei 13.709/2018).</p>

      <h2>Quem é o controlador</h2>
      <p>[Razão social], CNPJ [•], com sede em [•]. Encarregado de dados (DPO): [nome e e-mail].</p>

      <h2>Quais dados tratamos</h2>
      <ul>
        <li>Cadastro: nome, e-mail, telefone/WhatsApp, senha (armazenada apenas como hash).</li>
        <li>Lançamentos financeiros que você registra: valores, descrições, estabelecimentos, clientes, categorias, contas e datas.</li>
        <li>Mensagens do WhatsApp: o texto é usado para interpretar o pedido e é descartado após o processamento; mantemos apenas os lançamentos resultantes e um histórico curto (até 7 dias) para entender referências como “o último gasto”.</li>
        <li>Assinatura e pagamentos: plano, status e histórico de cobranças. CPF/CNPJ e dados de cartão são enviados diretamente ao Asaas e não ficam armazenados no FinanceZap.</li>
        <li>Registros técnicos: datas de acesso, IP e eventos de segurança, sem conteúdo financeiro.</li>
      </ul>

      <h2>Para que usamos</h2>
      <ul>
        <li>Prestar o serviço contratado (execução de contrato): registrar, calcular e apresentar suas informações financeiras.</li>
        <li>Cobrança da assinatura e obrigações legais e fiscais.</li>
        <li>Segurança, prevenção a fraudes e abuso (legítimo interesse).</li>
      </ul>

      <h2>Com quem compartilhamos (operadores)</h2>
      <ul>
        <li>Meta (WhatsApp Business Platform): transporte das mensagens.</li>
        <li>OpenAI: interpretação do texto das mensagens, transcrição de áudios e leitura de comprovantes. Enviamos o texto da mensagem, suas categorias e um resumo dos lançamentos recentes necessários para entender o pedido; quando você manda um áudio ou comprovante, enviamos o arquivo e o seu nome (para saber se o comprovante é de um pagamento seu ou de um valor que você recebeu). O arquivo não fica guardado no FinanceZap: guardamos só o lançamento gerado. [Confirmar e registrar as condições contratuais de uso e retenção de dados vigentes do provedor.]</li>
        <li>Asaas: processamento de pagamentos.</li>
        <li>Provedores de hospedagem e banco de dados: [listar].</li>
      </ul>
      <p>Alguns desses provedores podem tratar dados fora do Brasil. [Descrever o mecanismo de transferência internacional adotado, conforme a LGPD e a regulamentação da ANPD.]</p>

      <h2>Por quanto tempo</h2>
      <ul>
        <li>Lançamentos financeiros: enquanto sua conta existir.</li>
        <li>Texto de mensagens: apagado após o processamento (no máximo 30 dias em caso de falha).</li>
        <li>Registros técnicos: até 180 dias.</li>
        <li>Registros de pagamento: pelo prazo exigido pela legislação fiscal.</li>
      </ul>

      <h2>Seus direitos</h2>
      <p>Você pode, a qualquer momento, pelo painel: acessar e baixar todos os seus dados, corrigir informações, cancelar a assinatura e excluir sua conta. Para outros pedidos, fale com o encarregado pelo e-mail [•].</p>

      <h2>Segurança</h2>
      <p>Adotamos isolamento de dados por cliente no banco de dados, criptografia em trânsito, senhas com hash forte, controle de acesso por função e registro de acessos administrativos. Nenhum sistema é totalmente imune a incidentes; se algum ocorrer e puder causar risco relevante, comunicaremos os titulares afetados e a ANPD, conforme a lei.</p>
    </>
  );
}
