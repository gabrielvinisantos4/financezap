import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/server/db/client";
import { plans, users } from "@/server/db/schema";
import { listStalledSignups, sendRecoveryMessage } from "@/server/admin/recovery";
import { grantManualSubscription } from "@/server/billing/subscriptions";
import { createAffiliate } from "@/server/affiliates/affiliates";
import { dryRunOutbox } from "@/server/whatsapp/client";
import { makeUser, resetDb } from "./helpers";

const later = () => new Date(Date.now() + 2 * 3600_000);

beforeEach(async () => {
  await resetDb();
  dryRunOutbox.length = 0;
  await db().insert(plans).values({ slug: "basico", name: "Básico", priceMonthlyCents: 1690, priceYearlyCents: 16900, active: true, limits: { monthlyMessages: 300, monthlyAiCalls: 300, maxAccounts: 3, customCategories: false, advancedReports: false } });
});
afterAll(closeDb);

describe("cadastros parados", () => {
  it("lista quem não virou cliente, manda o modelo do WhatsApp uma vez e respeita o intervalo", async () => {
    const parado = await makeUser({ name: "Ana Paula", phone: "44991112222" });
    const cliente = await makeUser({ name: "Bruno", phone: "44993334444" });
    await grantManualSubscription(cliente.id, "basico", 15);
    const afiliado = await makeUser({ name: "Carla", phone: "44995556666" });
    await createAffiliate(afiliado.id, "carla");
    await makeUser({ name: "Sem Fone" });

    const list = await listStalledSignups(later());
    expect(list.map((r) => r.name).sort()).toEqual(["Ana Paula", "Sem Fone"]);
    expect(list.find((r) => r.name === "Sem Fone")).toMatchObject({ canSend: false, blockedReason: "Sem WhatsApp no cadastro" });

    await sendRecoveryMessage(parado.id, cliente.id, later());
    expect(dryRunOutbox).toHaveLength(1);
    expect(dryRunOutbox[0]).toMatchObject({
      to: "5544991112222",
      body: { type: "template", template: { name: "retomar_cadastro", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }] } },
    });
    const [u] = await db().select().from(users).where(eq(users.id, parado.id));
    expect(u.recoveryCount).toBe(1);

    // De novo logo em seguida: bloqueado pelo intervalo
    await expect(sendRecoveryMessage(parado.id, cliente.id, later())).rejects.toThrow(/Aguarde/);
    expect(dryRunOutbox).toHaveLength(1);
  });
});
