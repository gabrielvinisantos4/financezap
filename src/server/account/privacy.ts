import { eq, sql } from "drizzle-orm";
import { db, withUser } from "../db/client";
import { accounts, categories, consents, dataRequests, payments, recurringRules, subscriptions, transactions, transactionHistory, users, whatsappIdentities } from "../db/schema";
import { cancelSubscription, currentSubscription } from "../billing/subscriptions";
import { opEvent } from "../ops/events";

/** Exportação (portabilidade, LGPD art. 18): todos os dados do titular em JSON. */
export async function exportUserData(userId: string) {
  const [u] = await db().select().from(users).where(eq(users.id, userId));
  const financial = await withUser(userId, async (tx) => ({
    accounts: await tx.select().from(accounts).where(eq(accounts.userId, userId)),
    categories: await tx.select().from(categories).where(eq(categories.userId, userId)),
    transactions: await tx.select().from(transactions).where(eq(transactions.userId, userId)),
    transactionHistory: await tx.select().from(transactionHistory).where(eq(transactionHistory.userId, userId)),
    recurringRules: await tx.select().from(recurringRules).where(eq(recurringRules.userId, userId)),
  }));
  const data = {
    exportedAt: new Date().toISOString(),
    profile: { id: u.id, name: u.name, email: u.email, phone: u.phoneE164, timezone: u.timezone, createdAt: u.createdAt },
    whatsapp: await db().select({ waId: whatsappIdentities.waId, verifiedAt: whatsappIdentities.verifiedAt }).from(whatsappIdentities).where(eq(whatsappIdentities.userId, userId)),
    consents: await db().select().from(consents).where(eq(consents.userId, userId)),
    subscriptions: await db().select().from(subscriptions).where(eq(subscriptions.userId, userId)),
    payments: await db().select().from(payments).where(eq(payments.userId, userId)),
    ...financial,
  };
  await db().insert(dataRequests).values({ userId, type: "export", status: "done", completedAt: new Date() });
  return data;
}

/**
 * Exclusão da conta: cancela a assinatura no gateway, apaga dados financeiros e
 * pessoais e anonimiza o registro do usuário. Registros de pagamento são mantidos
 * apenas pelo prazo legal/fiscal (vinculados a um usuário anonimizado).
 */
export async function deleteAccount(userId: string) {
  await db().insert(dataRequests).values({ userId, type: "delete", status: "processing" });
  const sub = await currentSubscription(userId);
  if (sub && (sub.status === "active" || sub.status === "past_due" || sub.status === "pending")) {
    await cancelSubscription(userId).catch(async (err) => {
      await opEvent("error", "privacy.cancel_failed", "Falha ao cancelar assinatura durante exclusão de conta", { error: String(err).slice(0, 200) }, userId);
      throw err;
    });
  }
  await withUser(userId, async (tx) => {
    await tx.delete(transactionHistory).where(eq(transactionHistory.userId, userId));
    await tx.delete(transactions).where(eq(transactions.userId, userId));
    await tx.delete(recurringRules).where(eq(recurringRules.userId, userId));
    await tx.delete(categories).where(eq(categories.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.execute(sql`delete from conversation_turns where user_id = ${userId}`);
    await tx.execute(sql`delete from pending_actions where user_id = ${userId}`);
  });
  await db().delete(whatsappIdentities).where(eq(whatsappIdentities.userId, userId));
  await db().execute(sql`delete from sessions where user_id = ${userId}`);
  await db().execute(sql`delete from link_codes where user_id = ${userId}`);
  await db().execute(sql`update inbound_messages set payload = null, reply = null where user_id = ${userId}`);
  await db()
    .update(users)
    .set({ name: "Conta excluída", email: `excluido+${userId}@invalid.local`, phoneE164: null, passwordHash: "!", status: "deleted", deletedAt: new Date() })
    .where(eq(users.id, userId));
  await db().execute(sql`update data_requests set status = 'done', completed_at = now() where user_id = ${userId} and type = 'delete'`);
  await opEvent("info", "privacy.account_deleted", "Conta excluída a pedido do titular", undefined, userId);
}
