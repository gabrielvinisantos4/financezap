import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { env } from "../config/env";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

declare global {
  // eslint-disable-next-line no-var
  var __fzPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __fzDb: DB | undefined;
}

export function pool(): Pool {
  if (!globalThis.__fzPool) {
    const e = env();
    globalThis.__fzPool = new Pool({
      connectionString: e.DATABASE_URL,
      max: e.DATABASE_POOL_MAX,
      // Poolers gerenciados (ex.: Supabase) exigem TLS; o certificado é de CA própria do provedor
      ssl: e.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__fzPool;
}

/**
 * Conexão "crua". As tabelas financeiras têm Row Level Security forçada:
 * fora de `withUser`/`withSystem`, consultas a elas retornam zero linhas.
 */
export function db(): DB {
  if (!globalThis.__fzDb) globalThis.__fzDb = drizzle(pool(), { schema });
  return globalThis.__fzDb;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Executa `fn` numa transação em que o banco só enxerga os dados do usuário.
 * Mesmo que um bug no código esqueça um filtro por user_id, a política RLS
 * do PostgreSQL impede ler/alterar dados de outro cliente.
 */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("userId inválido");
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Contexto de sistema (jobs, agregações administrativas sem conteúdo pessoal,
 * exclusão de conta). Uso deliberado e restrito.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
    return fn(tx);
  });
}

export async function closeDb() {
  if (globalThis.__fzPool) {
    await globalThis.__fzPool.end();
    globalThis.__fzPool = undefined;
    globalThis.__fzDb = undefined;
  }
}
