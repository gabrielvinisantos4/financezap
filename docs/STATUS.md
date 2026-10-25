# Status do projeto (24/10/2026)

Suíte automatizada: **60 testes passando** (`npm test`) + **10 verificações HTTP** (`npm run smoke`) + fluxo real webhook → fila → worker → resposta validado com o servidor rodando (WhatsApp em modo simulado).

## Concluído e testado

- Motor financeiro em centavos: receitas, despesas, transferências (não contam no resultado), cartão de crédito (compra conta uma vez; fatura é `card_payment`), parcelamento (no cartão e fora dele), contas a pagar/receber, estornos com limite, recorrências idempotentes, histórico de alterações, controle de versão contra edição simultânea.
- Consultas calculadas no banco: resumo do período, totais, por categoria, por estabelecimento, por cliente, maior despesa/receita, últimos lançamentos, saldo × comprometido × projeção, contas a pagar, recorrentes, evolução mensal.
- Isolamento multiusuário com RLS e testes de tentativa de vazamento.
- Agente: registro em linguagem natural (até 5 lançamentos por mensagem), pergunta quando falta valor, confirmação para baixa confiança e valores altos, correção e exclusão sempre com confirmação, escolha entre candidatos ambíguos, detecção de duplicidade, botões interativos, idempotência por mensagem, contingência por regras quando a IA falha.
- WhatsApp: verificação do webhook, assinatura, deduplicação, fila com novas tentativas, ordem por número, resposta persistida antes do envio (reenvio sem reexecutar), status de entrega, vínculo seguro de número, bloqueio por assinatura/limite/abuso.
- Assinaturas Asaas: checkout, webhooks idempotentes com reconsulta, ativação, inadimplência com tolerância, estorno/chargeback, cancelamento com acesso até o fim do período, cortesia manual pelo admin.
- Painel do cliente: visão geral, lançamentos (filtros, edição, exclusão, estorno, marcar pago), contas e cartões, transferência/pagamento de fatura, relatórios com gráfico e CSV, categorias e recorrências, WhatsApp, assinatura, dados da conta, exportação e exclusão.
- Admin: métricas do negócio (MRR, ativos, atraso, cancelamentos, planos, uso e custo de IA/WhatsApp, falhas), clientes com dados mascarados, bloqueio/reativação, cortesia, planos e limites configuráveis, eventos operacionais e auditoria.
- Landing page responsiva, cadastro com consentimento, termos e privacidade (minutas).
- Retenção automática, logs sem dados sensíveis, Docker/compose, documentação.

## Depende de credenciais ou aprovação de terceiros

| Item | O que falta | Como concluir |
|---|---|---|
| WhatsApp real | Verificação da empresa na Meta, número comercial, token permanente, webhook público em HTTPS | docs/INTEGRACOES.md §1 |
| IA real | `OPENAI_API_KEY` e escolha/validação do modelo | docs/INTEGRACOES.md §2 |
| Pagamentos | Chave e webhook do Asaas (sandbox, depois produção com conta aprovada) | docs/INTEGRACOES.md §3 |
| Preços | Valores reais dos planos após cálculo de custos | docs/CUSTOS.md, admin → Planos |
| Jurídico | Revisão de termos/privacidade, DPO, contratos com operadores | docs/SEGURANCA-LGPD.md |
| Hospedagem | Domínio, HTTPS, Postgres/Redis gerenciados, backups | docs/DEPLOY.md |

## Não incluído nesta versão (próximos passos sugeridos)

- Recuperação de senha e confirmação de e-mail (precisa de provedor de e-mail transacional).
- Áudio (transcrição) e foto de comprovante.
- Lembretes proativos de contas a vencer (exigem modelos de mensagem aprovados pela Meta e são cobrados).
- Fatura do cartão por ciclo de fechamento no painel (hoje: em aberto + parcelas futuras).
- Autenticação em dois fatores para administradores.
- O build Docker não pôde ser executado neste ambiente (sem daemon Docker); o build Next.js e todos os testes rodaram.
