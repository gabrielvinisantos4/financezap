# Implantação

O sistema tem **dois processos** que usam o mesmo código e `.env`: o **site** (`npm start`, Next.js) e o **worker** (`npm run worker`, fila do WhatsApp e rotinas). Ambos precisam de PostgreSQL e Redis.

O worker é um processo contínuo, então hospedagem só serverless (ex.: Vercel sozinha) **não basta**. Opções:

- **VPS única com Docker** (mais simples e barato no início): `docker compose up -d --build`. Coloque Caddy ou Nginx na frente para HTTPS.
- **Plataforma de containers** (Railway, Render, Fly.io): um serviço web + um serviço worker a partir do mesmo Dockerfile, Postgres e Redis gerenciados.
- **Vercel + worker separado**: site na Vercel, worker num container; Postgres (Neon/Supabase) e Redis (Upstash com protocolo TCP) gerenciados.

## Checklist de produção

1. `NODE_ENV=production`, `APP_URL=https://seu-dominio`, `APP_SECRET` com 64 caracteres aleatórios (`openssl rand -hex 32`).
2. Usuário do PostgreSQL **sem** `SUPERUSER` e sem `BYPASSRLS` (a RLS depende disso). Conexão com TLS.
3. `npm run db:migrate` a cada versão; `npm run db:seed` uma vez (cria planos inativos e o proprietário).
4. No admin: revise preços e limites (docs/CUSTOS.md) e ative os planos.
5. Configure as integrações (docs/INTEGRACOES.md) e rode `npm run smoke` apontando para o domínio.
6. Monitoramento: `GET /api/health` (banco e Redis) num monitor externo; logs estruturados em JSON (pino) para o seu agregador; a aba **Operação** do admin mostra falhas.

## Backups e restauração

- **Diário** com retenção de 30 dias, mais *point-in-time recovery* se o provedor oferecer.
- Manual: `pg_dump --format=custom --no-owner "$DATABASE_URL" > financezap-$(date +%F).dump`
- Guarde backups criptografados e fora do servidor do banco.
- **Restauração** (teste a cada trimestre num banco separado):
  ```bash
  createdb financezap_restore
  pg_restore --no-owner --dbname=financezap_restore financezap-AAAA-MM-DD.dump
  DATABASE_URL=.../financezap_restore npm run smoke   # com um site apontando para ele
  ```
- O Redis guarda só filas e limites de taxa; se perder, a rotina `requeue` reprocessa mensagens que ficaram em `queued` no banco.

## Atualizações sem perder mensagens

O webhook grava a mensagem no banco antes de responder à Meta. Durante um deploy, mensagens ficam em fila e o worker as processa ao voltar; a rotina de reenfileiramento (a cada 2 minutos) cobre qualquer perda do Redis.
