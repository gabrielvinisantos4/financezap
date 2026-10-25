# Custos e viabilidade

Os preços dos planos no seed (R$ 19,90 / 29,90 / 49,90) são **exemplos para estruturar o sistema**, criados como inativos. Defina os valores reais no admin depois de preencher a planilha abaixo com as tarifas vigentes.

## Custos variáveis por mensagem do cliente

Cada mensagem do cliente gera, em média:

| Item | Como estimar | Onde configurar |
|---|---|---|
| IA | ~1.500 tokens de entrada (instruções + categorias + contexto) e ~150 de saída por mensagem interpretada | `OPENAI_PRICE_INPUT_PER_M`, `OPENAI_PRICE_OUTPUT_PER_M` |
| WhatsApp | 1 mensagem de serviço enviada (resposta). Mensagens recebidas são grátis. 1.000 mensagens de serviço gratuitas por número/mês; acima disso, tarifa do Brasil na tabela da Meta | `WHATSAPP_COST_PER_SERVICE_MESSAGE_USD` |

Exemplo com `gpt-4.1-mini` a US$ 0,40 / US$ 1,60 por milhão de tokens: 1.500 × 0,40/10⁶ + 150 × 1,60/10⁶ ≈ **US$ 0,00084 por mensagem**. Confirme o preço vigente do modelo escolhido.

Para o WhatsApp, a documentação da Meta cita cerca de US$ 0,0068 por mensagem utilitária no Brasil; a tarifa de **serviço** está na planilha oficial de tarifas (BRL list rates). Use o valor real dela. Contas com faturamento no Brasil passam a ser cobradas em reais.

## Custo por assinante (fórmula)

```
custo_variavel = msgs_mes × (custo_IA + custo_WhatsApp_por_resposta) + taxa_gateway
taxa_gateway   = tarifa do Asaas para a forma de pagamento usada (Pix, boleto ou cartão)
custo_fixo_rateado = (hospedagem + banco + Redis + monitoramento + domínio) ÷ assinantes
custo_total = custo_variavel + custo_fixo_rateado
margem_bruta = (preço − custo_total) ÷ preço
```

Exemplo ilustrativo (verifique todas as tarifas): 150 mensagens/mês, US$ 0,00084 de IA, US$ 0,007 de WhatsApp, câmbio 5,5:
`150 × (0,00084 + 0,007) × 5,5 ≈ R$ 6,47` de custo variável de mensagens, antes da tarifa do Asaas e dos fixos. O WhatsApp é o maior custo variável; por isso o limite mensal de mensagens por plano é a principal alavanca de margem.

## Ponto de equilíbrio

```
assinantes_necessarios = custos_fixos_mensais ÷ (preço_médio − custo_variável_médio)
```

Exemplo: fixos de R$ 300/mês (VPS + banco + backup + domínio), preço médio R$ 29,90, variável médio R$ 9 → 300 ÷ 20,90 ≈ **15 assinantes**.

## Proteções contra consumo excessivo (já implementadas)

- Limite mensal de mensagens e de chamadas de IA por plano (configuráveis no admin). Ao estourar a IA, o sistema segue com o interpretador por regras; ao estourar mensagens, avisa uma vez por dia e para de responder.
- Respostas simples (sim/não/número/botões) não usam IA.
- Limite de 20 mensagens/minuto por número; números desconhecidos recebem no máximo uma resposta a cada 12h.
- Painel admin mostra consumo de tokens e custo estimado do mês. Configure também um **limite de gasto** no painel da OpenAI.
