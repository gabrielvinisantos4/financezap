import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createUser } from "@/server/auth/users";

/** Limpa todas as tabelas entre testes (dados fictícios apenas). */
export async function resetDb() {
  const r = await db().execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  const names = r.rows.map((x) => `"${x.tablename}"`).join(", ");
  if (names) await db().execute(sql.raw(`truncate ${names} restart identity cascade`));
}

export async function makeUser(overrides: Partial<{ name: string; email: string; phone: string }> = {}) {
  return createUser({
    name: overrides.name ?? "Cliente Teste",
    email: overrides.email ?? `teste-${randomUUID().slice(0, 8)}@exemplo.test`,
    password: "senhaSegura123",
    phone: overrides.phone,
    acceptTerms: true,
  });
}

export const TODAY = "2026-10-24";
