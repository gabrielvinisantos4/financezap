import { eq, sql } from "drizzle-orm";
import { db, closeDb } from "../src/server/db/client";
import { plans, users } from "../src/server/db/schema";
import { createUser } from "../src/server/auth/users";
import { env } from "../src/server/config/env";

/**
 * Cria os planos-modelo (INATIVOS e com preços de exemplo) e o usuário proprietário.
 * Preços e limites devem ser revisados e ativados no painel administrativo,
 * depois de calcular o custo por cliente (veja docs/CUSTOS.md).
 *
 *   npm run db:seed                 -> planos inativos
 *   npm run db:seed -- --activate   -> ativa os planos-modelo (apenas desenvolvimento)
 */
const EXAMPLE_PLANS = [
  {
    slug: "basico",
    name: "Básico",
    description: "Registre receitas e despesas pelo WhatsApp e acompanhe o mês.",
    priceMonthlyCents: 1990,
    priceYearlyCents: 19900,
    sortOrder: 1,
    features: ["Registro de receitas e despesas pelo WhatsApp", "Consultas financeiras", "Relatório mensal no painel"],
    limits: { monthlyMessages: 300, monthlyAiCalls: 300, maxAccounts: 3, customCategories: false, advancedReports: false },
  },
  {
    slug: "pro",
    name: "Pro",
    description: "Para quem quer organizar contas, cartões e categorias próprias.",
    priceMonthlyCents: 2990,
    priceYearlyCents: 29900,
    sortOrder: 2,
    features: ["Tudo do Básico", "Categorias personalizadas", "Relatórios avançados e evolução mensal", "Consultas detalhadas", "Limite maior de uso"],
    limits: { monthlyMessages: 1000, monthlyAiCalls: 1000, maxAccounts: 10, customCategories: true, advancedReports: true },
  },
  {
    slug: "premium",
    name: "Premium",
    description: "Uso intenso e organização financeira completa.",
    priceMonthlyCents: 4990,
    priceYearlyCents: 49900,
    sortOrder: 3,
    features: ["Tudo do Pro", "Relatórios adicionais", "Recursos avançados de organização", "Limites superiores"],
    limits: { monthlyMessages: 3000, monthlyAiCalls: 3000, maxAccounts: 30, customCategories: true, advancedReports: true },
  },
];

async function main() {
  const activate = process.argv.includes("--activate");
  for (const p of EXAMPLE_PLANS) {
    const [existing] = await db().select().from(plans).where(eq(plans.slug, p.slug));
    if (existing) {
      if (activate && !existing.active) await db().update(plans).set({ active: true }).where(eq(plans.id, existing.id));
      continue;
    }
    await db().insert(plans).values({ ...p, active: activate });
  }
  console.log(`Planos-modelo prontos (${activate ? "ATIVOS" : "inativos — revise e ative no painel admin"}).`);

  const e = env();
  if (e.OWNER_EMAIL && e.OWNER_PASSWORD) {
    const [exists] = await db().select().from(users).where(sql`lower(${users.email}) = ${e.OWNER_EMAIL.toLowerCase()}`);
    if (!exists) {
      const u = await createUser({ name: "Proprietário", email: e.OWNER_EMAIL, password: e.OWNER_PASSWORD, acceptTerms: true }, {}, "owner");
      await db().update(users).set({ canViewPii: true }).where(eq(users.id, u.id));
      console.log(`Proprietário criado: ${e.OWNER_EMAIL}`);
    } else if (exists.role !== "owner") {
      await db().update(users).set({ role: "owner", canViewPii: true }).where(eq(users.id, exists.id));
      console.log(`Usuário ${e.OWNER_EMAIL} promovido a proprietário.`);
    }
  } else {
    console.log("OWNER_EMAIL/OWNER_PASSWORD não definidos: proprietário não criado.");
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
