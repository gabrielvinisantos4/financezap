# FinanceZap

Assistente financeiro pessoal pelo WhatsApp, vendido por assinatura. O cliente escreve “gastei 50 no posto” e o sistema registra, categoriza, responde consultas, corrige e exclui lançamentos — com isolamento total de dados entre clientes.

## O que há aqui

| Parte | Onde | Estado |
|---|---|---|
| Motor financeiro (centavos, cartão, fatura, parcelas, estornos, transferências, recorrências, histórico) | `src/server/finance` | Pronto e testado |
| Agente (IA + contingência por regras, confirmações, ambiguidade, idempotência) | `src/server/agent` | Pronto e testado com IA simulada; falta testar com chave real da OpenAI |
| WhatsApp Cloud API (webhook assinado, dedupe, fila, worker, botões, vínculo de número) | `src/server/whatsapp`, `scripts/worker.ts` | Pronto e testado de ponta a ponta em modo simulado; falta número/credenciais da Meta |
| Assinaturas Asaas (checkout, webhooks, inadimplência, tolerância, cancelamento) | `src/server/billing` | Pronto e testado com Asaas simulado; falta chave sandbox/produção |
| Painel do cliente e área administrativa | `src/app/app`, `src/app/admin` | Pronto |
| Página de vendas, cadastro e onboarding | `src/app/page.tsx`, `src/app/(auth)` | Pronto |
| Segurança e LGPD (RLS, sessões, rate limit, retenção, exportação, exclusão) | vários | Pronto; textos legais são minuta |

Detalhes do que está pronto e do que depende de terceiros: **[docs/STATUS.md](docs/STATUS.md)**.

## Arquitetura

```
WhatsApp (Meta) ──webhook──▶ Next.js /api/whatsapp/webhook ──▶ Postgres (inbound_messages, chave única)
                                    │                                   │
                                    └── fila BullMQ (Redis) ──▶ worker ─┤
                                                                         ├─ entitlement / limites do plano
                                                                         ├─ agente: IA interpreta → Zod valida → backend executa
                                                                         ├─ motor financeiro (SQL, centavos, RLS por cliente)
                                                                         └─ resposta salva → enviada pela Cloud API
Asaas ──webhook──▶ /api/billing/asaas/webhook ──▶ reconsulta o pagamento na API ──▶ assinatura
Navegador ──▶ Next.js (landing, painel, admin) ──▶ mesmas regras do motor
```

- **Stack:** TypeScript, Next.js 15, PostgreSQL 16, Drizzle ORM (migrações SQL versionadas em `drizzle/`), Redis + BullMQ, OpenAI (Structured Outputs), Asaas, Vitest.
- **Isolamento:** toda leitura/escrita financeira roda em `withUser(userId)`, que ativa uma política de Row Level Security forçada no PostgreSQL. Mesmo uma consulta que esqueça o filtro por usuário não vê dados de outro cliente. Chaves estrangeiras compostas impedem um lançamento de apontar para conta/categoria de outro cliente.
- **IA sem poder:** o modelo só devolve um JSON (esquema estrito) com a interpretação. Não tem ferramentas, não acessa o banco, não calcula totais. O backend valida e decide. Sem chave da OpenAI, o sistema usa um interpretador por regras que cobre as frases mais comuns.

## Rodar localmente

Requisitos: Node 20+, PostgreSQL 16, Redis 7 (ou Docker).

```bash
cp .env.example .env            # preencha APP_SECRET e DATABASE_URL; deixe WHATSAPP_DRY_RUN=true
npm install
npm run db:migrate
npm run db:seed -- --activate   # planos-modelo ativos + proprietário (OWNER_EMAIL/OWNER_PASSWORD)
npm run dev                     # site em http://localhost:3000
npm run worker                  # em outro terminal: fila do WhatsApp e rotinas
```

Com Docker: `docker compose up -d --build` (sobe Postgres, Redis, migrações, site e worker).

> O banco da aplicação **não pode** usar um usuário superusuário do PostgreSQL: superusuários ignoram RLS.

## Testes

```bash
createdb financezap_test        # banco separado; o nome precisa conter "_test"
npm test                        # 60 testes: motor, isolamento, agente, WhatsApp+fila, Asaas, admin, LGPD
npm run smoke                   # com o servidor rodando: rotas protegidas e webhooks
```

Os testes usam apenas dados fictícios, em banco e Redis (db 15) próprios.

## Documentação

- [docs/INTEGRACOES.md](docs/INTEGRACOES.md) — configurar Meta/WhatsApp, OpenAI e Asaas
- [docs/DEPLOY.md](docs/DEPLOY.md) — implantação, backups e restauração
- [docs/CUSTOS.md](docs/CUSTOS.md) — custo por assinante, margem e ponto de equilíbrio
- [docs/SEGURANCA-LGPD.md](docs/SEGURANCA-LGPD.md) — controles, retenção, incidentes e pontos para validação jurídica
- [docs/STATUS.md](docs/STATUS.md) — funcionalidades concluídas e pendências externas
