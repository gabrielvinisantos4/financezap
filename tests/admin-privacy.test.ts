import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db, withUser } from "@/server/db/client";
import { adminAuditLogs, plans, users } from "@/server/db/schema";
import { businessMetrics, savePlan, searchCustomers, setUserBlocked } from "@/server/admin/admin";
import { exportUserData, deleteAccount } from "@/server/account/privacy";
import { grantManualSubscription } from "@/server/billing/subscriptions";
import { createEntry } from "@/server/finance/engine";
import { listTransactions } from "@/server/finance/queries";
import { verifyCredentials } from "@/server/auth/users";
import { signupSchema } from "@/server/auth/users";
import { makeUser, resetDb, TODAY } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await db().insert(plans).values({ slug: "pro", name: "Pro", priceMonthlyCents: 2990, priceYearlyCents: 29900, active: true, limits: { monthlyMessages: 1000, monthlyAiCalls: 1000, maxAccounts: 10, customCategories: true, advancedReports: true } });
});
afterAll(closeDb);

async function makeAdmin(role: "support" | "admin" | "owner", canViewPii = false) {
  const u = await makeUser({ name: `Admin ${role}` });
  const [a] = await db().update(users).set({ role, canViewPii }).where(eq(users.id, u.id)).returning();
  return a;
}

describe("área administrativa", () => {
  it("métricas não expõem dados financeiros de clientes", async () => {
    const c = await makeUser();
    await grantManualSubscription(c.id, "pro", 30);
    await withUser(c.id, (tx) => createEntry(tx, c.id, { kind: "expense", amountCents: 987654, description: "Segredo", occurredOn: TODAY, source: "web" }, "user", TODAY));
    const m = await businessMetrics();
    const dump = JSON.stringify(m);
    expect(dump).not.toContain("987654");
    expect(dump).not.toContain("Segredo");
    expect(m.subscriptions.active).toBe(1);
    expect(m.subscriptions.courtesy).toBe(1);
  });

  it("sem permissão de PII, dados aparecem mascarados e busca por e-mail não funciona", async () => {
    const support = await makeAdmin("support");
    const c = await makeUser({ name: "Maria Silva", email: "maria@exemplo.test", phone: "44999991234" });
    expect(await searchCustomers(support, "maria@", false)).toHaveLength(0);
    const [row] = await searchCustomers(support, c.id, false);
    expect(row.email).toBe("ma***@exemplo.test");
    expect(row.name).not.toContain("Silva");
    expect(row.phone).not.toContain("99991");
  });

  it("com permissão de PII, a busca é registrada na auditoria", async () => {
    const owner = await makeAdmin("owner", true);
    await makeUser({ email: "joao@exemplo.test" });
    const rows = await searchCustomers(owner, "joao@", true);
    expect(rows[0].email).toBe("joao@exemplo.test");
    expect((await db().select().from(adminAuditLogs)).map((a) => a.action)).toContain("customers.search_pii");
  });

  it("bloqueio exige motivo, não atinge o proprietário e fica auditado", async () => {
    const admin = await makeAdmin("admin");
    const owner = await makeAdmin("owner", true);
    const c = await makeUser();
    await expect(setUserBlocked(admin, c.id, true, "")).rejects.toMatchObject({ code: "invalid" });
    await expect(setUserBlocked(admin, owner.id, true, "teste")).rejects.toMatchObject({ code: "forbidden" });
    await setUserBlocked(admin, c.id, true, "Uso abusivo");
    const [u] = await db().select().from(users).where(eq(users.id, c.id));
    expect(u.status).toBe("blocked");
    expect((await db().select().from(adminAuditLogs))[0]).toMatchObject({ action: "user.block", targetUserId: c.id });
  });

  it("plano não pode ser ativado sem preço", async () => {
    const admin = await makeAdmin("admin");
    await expect(
      savePlan(admin, { slug: "gratis", name: "Grátis", description: "", priceMonthlyCents: 0, priceYearlyCents: 0, features: [], monthlyMessages: 10, monthlyAiCalls: 10, maxAccounts: 1, customCategories: false, advancedReports: false, active: true, sortOrder: 9 }),
    ).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("LGPD: exportação e exclusão", () => {
  it("exporta somente os dados do titular", async () => {
    const a = await makeUser({ name: "Ana" });
    const b = await makeUser({ name: "Bruno" });
    await withUser(a.id, (tx) => createEntry(tx, a.id, { kind: "income", amountCents: 1000, description: "Ana renda", occurredOn: TODAY, source: "web" }, "user", TODAY));
    await withUser(b.id, (tx) => createEntry(tx, b.id, { kind: "income", amountCents: 2000, description: "Bruno renda", occurredOn: TODAY, source: "web" }, "user", TODAY));
    const data = await exportUserData(a.id);
    expect(data.transactions).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("Bruno");
    expect(JSON.stringify(data)).not.toContain("password");
  });

  it("exclusão apaga dados financeiros, anonimiza o perfil e impede login", async () => {
    const u = await makeUser({ email: "excluir@exemplo.test" });
    await withUser(u.id, (tx) => createEntry(tx, u.id, { kind: "expense", amountCents: 1000, description: "x", occurredOn: TODAY, source: "web" }, "user", TODAY));
    await deleteAccount(u.id);
    expect(await withUser(u.id, (tx) => listTransactions(tx, u.id))).toHaveLength(0);
    const [row] = await db().select().from(users).where(eq(users.id, u.id));
    expect(row).toMatchObject({ status: "deleted", phoneE164: null, name: "Conta excluída" });
    expect(await verifyCredentials("excluir@exemplo.test", "senhaSegura123")).toBeNull();
  });
});

describe("validação de entrada", () => {
  it("cadastro rejeita senha fraca, e-mail inválido e falta de aceite", () => {
    const base = { name: "Fulano", email: "f@ex.test", password: "senhaForte123", acceptTerms: true as const };
    expect(signupSchema.safeParse(base).success).toBe(true);
    expect(signupSchema.safeParse({ ...base, password: "123" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, email: "nao-e-email" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, acceptTerms: false }).success).toBe(false);
    expect(signupSchema.parse({ ...base, phone: "(44) 99999-8888" }).phone).toBe("5544999998888");
  });

  it("valores absurdos e datas inválidas são barrados pelo motor e pelo banco", async () => {
    const u = await makeUser();
    await expect(withUser(u.id, (tx) => createEntry(tx, u.id, { kind: "expense", amountCents: -5, description: "x", occurredOn: TODAY, source: "web" }, "user", TODAY))).rejects.toThrow();
    await expect(withUser(u.id, (tx) => createEntry(tx, u.id, { kind: "expense", amountCents: 100, description: "x", occurredOn: "2026-02-30", source: "web" }, "user", TODAY))).rejects.toThrow();
    await expect(withUser(u.id, (tx) => createEntry(tx, u.id, { kind: "expense", amountCents: 100, description: "   ", occurredOn: TODAY, source: "web" }, "user", TODAY))).rejects.toThrow();
  });
});
