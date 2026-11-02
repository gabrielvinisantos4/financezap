import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { env } from "../config/env";
import { grantManualSubscription } from "../billing/subscriptions";
import { opEvent } from "../ops/events";

/**
 * Pós-cadastro:
 *  - quem se cadastra com OWNER_EMAIL vira proprietário (acesso ao admin);
 *  - com AUTO_TRIAL_PLAN definido, novos clientes ganham um período de teste
 *    sem cobrança (útil no beta, antes de ligar o Asaas).
 */
export async function applySignupPerks(userId: string, email: string) {
  const e = env();
  if (e.OWNER_EMAIL && email.toLowerCase() === e.OWNER_EMAIL.toLowerCase()) {
    await db().update(users).set({ role: "owner", canViewPii: true }).where(eq(users.id, userId));
  }
  if (e.AUTO_TRIAL_PLAN) {
    try {
      await grantManualSubscription(userId, e.AUTO_TRIAL_PLAN, e.AUTO_TRIAL_DAYS);
    } catch (err) {
      await opEvent("warn", "signup.trial_failed", "Não foi possível liberar o período de teste", { error: String(err).slice(0, 200) }, userId);
    }
  }
}
