# Segurança, privacidade e LGPD

Não há segurança absoluta nem conformidade automática. Abaixo está o que o sistema faz e o que precisa de validação jurídica e operacional antes do lançamento.

## Controles implementados

| Tema | Implementação |
|---|---|
| Isolamento de dados | RLS forçada no PostgreSQL para contas, categorias, lançamentos, histórico, recorrências, pendências e conversas; chaves estrangeiras compostas por usuário; testes de vazamento entre clientes |
| Autenticação | Senha com Argon2id; sessão em cookie httpOnly/SameSite, token guardado só como HMAC no banco; expiração de 30 dias |
| Autorização | Papéis `user`, `support`, `admin`, `owner`; dados pessoais no admin só com a permissão explícita `can_view_pii`; rotas admin devolvem 404 para quem não tem acesso |
| Admin sem dinheiro alheio | Métricas e buscas não consultam tabelas financeiras; dados pessoais mascarados por padrão; buscas com PII, bloqueios, cortesias e mudanças de plano vão para a auditoria |
| WhatsApp | Assinatura HMAC-SHA256 do corpo bruto validada antes de tudo; deduplicação por id da Meta; vínculo de número por código de 8 dígitos, uso único, 15 min, com limite de tentativas; telefone não é usado como autorização interna |
| Pagamentos | Token do webhook comparado em tempo constante; pagamento reconsultado na API do Asaas antes de liberar acesso; eventos idempotentes; nenhum dado de cartão ou CPF armazenado |
| IA | Saída em esquema estrito validada por Zod; IA sem ferramentas nem acesso ao banco; instruções contra injeção; mensagens limitadas a 1.000 caracteres; números sempre calculados pelo backend |
| Entradas | Validação Zod nas ações; valores em centavos com checagens no banco (`> 0`, datas válidas, transferência com contas distintas); CSV com proteção contra injeção de fórmulas |
| Abuso | Limites de taxa (login, cadastro, webhook, mensagens por número, exportação) e limites mensais por plano |
| Logs | Pino com campos sensíveis removidos; eventos operacionais sem conteúdo de mensagens ou valores |
| Transporte | HTTPS obrigatório em produção (cookie `secure`); Meta e Asaas exigem HTTPS |

## Retenção (rotina diária no worker)

| Dado | Prazo |
|---|---|
| Texto de mensagens recebidas | Apagado após o processamento; restos em até 30 dias |
| Registro técnico de mensagens | 90 dias |
| Contexto de conversa para a IA | 7 dias |
| Pendências, códigos de vínculo, sessões expiradas | 7 dias |
| Eventos operacionais | 180 dias |
| Dados financeiros | Enquanto a conta existir |
| Pagamentos | Prazo legal/fiscal (vinculados a usuário anonimizado após exclusão) |

## Direitos do titular

No painel (Minha conta): exportar todos os dados em JSON, corrigir dados, cancelar assinatura e excluir a conta (cancela no Asaas, apaga dados financeiros, desvincula o WhatsApp e anonimiza o perfil). Consentimentos de termos e privacidade são registrados com versão, data e IP.

## Papéis (LGPD)

- **Controlador:** a empresa que vende o FinanceZap.
- **Operadores:** Meta (WhatsApp), OpenAI, Asaas, hospedagem/banco/Redis. Formalize os contratos (DPA) e registre-os.
- **Transferência internacional:** OpenAI, Meta e provavelmente a hospedagem tratam dados fora do Brasil — exige base adequada (cláusulas padrão conforme regulamento da ANPD).

## Validar antes do lançamento

1. Revisão jurídica dos **Termos** e da **Política de privacidade** (as páginas estão marcadas como minuta), incluindo dados do controlador e do encarregado, política de reembolso e direito de arrependimento (CDC art. 49).
2. Base legal para enviar texto de mensagens à OpenAI e condições de retenção do provedor.
3. Nomear o encarregado (DPO) e criar o canal de atendimento ao titular.
4. Registro das operações de tratamento (ROPA) e, se recomendado, relatório de impacto (RIPD).
5. Política interna de acesso: quem recebe `can_view_pii` e por quê.
6. Teste de invasão externo antes de escalar.

## Resposta a incidentes

1. **Conter:** revogar tokens expostos (Meta, OpenAI, Asaas), trocar `APP_SECRET` (invalida sessões), bloquear acessos suspeitos.
2. **Avaliar:** usar logs, aba Operação e auditoria para delimitar dados e titulares afetados.
3. **Comunicar:** se houver risco ou dano relevante, comunicar a ANPD e os titulares no prazo regulamentar.
4. **Corrigir e registrar:** causa raiz, ações tomadas e lições, guardando o registro do incidente.
