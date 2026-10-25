import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/** Recria o schema do banco de teste do zero e aplica as migrações reais. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://financezap:financezap@localhost:5432/financezap_test";
  if (!/_test/.test(url)) throw new Error("Por segurança, o banco de teste precisa ter '_test' no nome");
  const pool = new Pool({ connectionString: url });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
}
