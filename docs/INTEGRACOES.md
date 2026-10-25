# Integrações

Nenhuma integração foi testada com credenciais reais neste desenvolvimento. Tudo foi validado com simulações fiéis aos formatos documentados. Siga os passos abaixo e rode os testes de aceitação no fim de cada seção.

## 1. WhatsApp Business Platform (Cloud API)

### Estratégia de número

O produto usa **um número comercial do FinanceZap** que conversa com todos os clientes. Cada cliente é identificado pelo `wa_id` de quem escreve, vinculado à conta por um código de uso único gerado no painel. O cliente **não** precisa ter WhatsApp Business nem conta na Meta.

Por que não um número por cliente: exigiria Embedded Signup, uma WABA por cliente e aprovação de cada número — caro e lento para um produto de assinatura barato. Um número único funciona bem porque toda conversa é **iniciada pelo cliente** (janela de atendimento de 24h, sem modelo aprovado). Limites a acompanhar:

- **Throughput** do número (mensagens/segundo) — suficiente para milhares de clientes; a fila absorve picos.
- **Qualidade do número**: bloqueios e denúncias derrubam a classificação. Responda só a quem escreveu; não faça disparos.
- **Mensagens iniciadas pela empresa** (lembretes de contas, por exemplo) exigem modelos aprovados e são cobradas. Não estão ativadas nesta versão.
- **Cobrança**: a Meta cobra por mensagem entregue. Mensagens de serviço têm 1.000 gratuitas por número/mês; a partir daí são cobradas (veja docs/CUSTOS.md).

### Passo a passo

1. **Business Manager**: crie ou use o portfólio empresarial da sua empresa (Gabriel Vinicius Mídia & Marketing, por exemplo) e faça a **verificação da empresa** (CNPJ, documento, domínio). Sem verificação, os limites são baixos.
2. **App na Meta for Developers**: crie um app do tipo *Business* e adicione o produto **WhatsApp**.
3. **Número**: adicione um número que **não** esteja em uso em nenhum WhatsApp (nem no app Business). Ele vai receber SMS/ligação para confirmação. Defina o nome de exibição “FinanceZap” (passa por aprovação).
4. **Token permanente**: em Configurações do negócio → Usuários do sistema, crie um usuário do sistema (admin), atribua o app e a conta do WhatsApp, e gere um token com `whatsapp_business_messaging` e `whatsapp_business_management`. Use esse token em `WHATSAPP_ACCESS_TOKEN` (o token temporário do painel expira em 24h).
5. Copie para o `.env`:
   - `WHATSAPP_PHONE_NUMBER_ID` (ID do número, não o telefone)
   - `WHATSAPP_APP_SECRET` (Configurações do app → Básico → Chave secreta)
   - `WHATSAPP_VERIFY_TOKEN` (um texto aleatório que você inventa)
   - `WHATSAPP_BUSINESS_NUMBER` (ex.: `5544999999999`, usado no link wa.me)
   - `WHATSAPP_DRY_RUN=false`
6. **Webhook**: em WhatsApp → Configuração, informe `https://SEU_DOMINIO/api/whatsapp/webhook` e o mesmo verify token. Assine o campo **messages**. O endereço precisa de HTTPS válido.
7. **Forma de pagamento** na conta do WhatsApp (obrigatória para enviar além da cota gratuita).

### Teste de aceitação
- `GET /api/whatsapp/webhook` com o token certo devolve o challenge (a Meta faz isso ao salvar).
- Crie uma conta no painel, libere uma cortesia pelo admin, gere o código e envie “Vincular XXXXXXXX”: deve chegar a confirmação.
- “Gastei 50 no posto” → resposta “✅ Despesa registrada!”; confira em Lançamentos.
- Desligue o worker, mande mensagens, religue: devem ser processadas em ordem, sem duplicar.

## 2. OpenAI

1. Crie uma chave em platform.openai.com → API keys, de preferência num **projeto** só do FinanceZap, com **limite de gasto mensal** configurado.
2. `.env`: `OPENAI_API_KEY`, `OPENAI_MODEL` (precisa suportar *Structured Outputs* com `json_schema` estrito; o padrão é `gpt-4.1-mini` — confirme na documentação se ainda está disponível e escolha o menor modelo que acerte bem as frases de teste), `OPENAI_PRICE_INPUT_PER_M` e `OPENAI_PRICE_OUTPUT_PER_M` com os preços vigentes (usados só para o painel de custos).
3. Sem chave, o sistema funciona com o interpretador por regras (frases comuns). Com chave, mensagens simples (sim/não/número) continuam sem gastar IA.

### Teste de aceitação
Envie as frases da especificação e variações (“tirei 40 no ifood ontem”, “entrou 1,5k do cliente X”, “quanto foi de mercado em setembro?”). Confira categorias e datas. Erros recorrentes: ajuste o prompt em `src/server/agent/llm.ts` (`buildSystemPrompt`) e acrescente o caso em `tests/agent.test.ts`.

## 3. Asaas

1. Crie conta no **sandbox** (sandbox.asaas.com) e gere a chave de API (Integrações → Chave de API).
2. `.env`: `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` (32+ caracteres aleatórios; não use a chave de API).
3. No Asaas: Integrações → Webhooks → novo webhook para `https://SEU_DOMINIO/api/billing/asaas/webhook`, versão v3, com o **token de autenticação** igual a `ASAAS_WEBHOOK_TOKEN`, fila sincronizada, eventos de **cobranças** e de **assinaturas**.
4. As assinaturas são criadas com `billingType: UNDEFINED`: o cliente escolhe Pix, boleto ou cartão na fatura do Asaas. O FinanceZap nunca vê dados de cartão e não guarda CPF/CNPJ.

Como o acesso é liberado: só por evento `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` **e** depois de reconsultar o pagamento na API do Asaas. Atraso (`PAYMENT_OVERDUE`) dá a tolerância de `BILLING_GRACE_DAYS`; estorno/chargeback suspende; cancelamento mantém acesso até o fim do período pago.

### Teste de aceitação (sandbox)
Assine um plano no painel → pague a fatura no sandbox (o Asaas permite confirmar pagamento de teste) → o painel mostra “Ativa” → mande mensagem no WhatsApp. Teste também vencimento (atraso), cancelamento e reativação. Depois troque para `https://api.asaas.com/v3` e a chave de produção (conta aprovada).
