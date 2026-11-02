import IORedis, { type Redis } from "ioredis";
import { env } from "../config/env";

declare global {
  // eslint-disable-next-line no-var
  var __fzRedis: Redis | undefined;
  // eslint-disable-next-line no-var
  var __fzMemCounters: Map<string, { n: number; exp: number }> | undefined;
}

/** Redis é opcional em modo de teste/hospedagem serverless: sem REDIS_URL usamos memória. */
export function redisEnabled(): boolean {
  return Boolean(env().REDIS_URL);
}

export function redis(): Redis {
  if (!redisEnabled()) throw new Error("Redis não configurado (REDIS_URL)");
  if (!globalThis.__fzRedis) {
    globalThis.__fzRedis = new IORedis(env().REDIS_URL!, { maxRetriesPerRequest: null, lazyConnect: false });
  }
  return globalThis.__fzRedis;
}

export async function closeRedis() {
  if (globalThis.__fzRedis) {
    await globalThis.__fzRedis.quit().catch(() => undefined);
    globalThis.__fzRedis = undefined;
  }
}

function memIncr(key: string, windowSec: number): number {
  globalThis.__fzMemCounters ??= new Map();
  const now = Date.now();
  const cur = globalThis.__fzMemCounters.get(key);
  if (!cur || cur.exp < now) {
    globalThis.__fzMemCounters.set(key, { n: 1, exp: now + windowSec * 1000 });
    return 1;
  }
  cur.n++;
  return cur.n;
}

/**
 * Janela fixa simples. Retorna true se a ação está permitida.
 * Sem Redis, conta em memória (por instância). Com Redis indisponível, falha aberta
 * para não derrubar o atendimento (o limite mensal por plano continua no banco).
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  if (!redisEnabled()) return memIncr(k, windowSec) <= limit;
  try {
    const n = await redis().incr(k);
    if (n === 1) await redis().expire(k, windowSec + 5);
    return n <= limit;
  } catch {
    return true;
  }
}

/** Trava curta por chave (ex.: um cliente) para processar mensagens em ordem. */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>, waitMs = 15000): Promise<T> {
  if (!redisEnabled()) return fn();
  const lockKey = `lock:${key}`;
  const token = Math.random().toString(36).slice(2);
  const started = Date.now();
  while (true) {
    const ok = await redis().set(lockKey, token, "PX", ttlMs, "NX");
    if (ok) break;
    if (Date.now() - started > waitMs) throw new Error(`Não foi possível obter a trava ${key}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  try {
    return await fn();
  } finally {
    await redis().eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, token);
  }
}
