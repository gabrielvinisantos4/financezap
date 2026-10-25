import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { linkCodes, whatsappIdentities, users } from "../db/schema";
import { hmac, randomDigits } from "../security/crypto";
import { env } from "../config/env";

/**
 * Vínculo seguro do número: o cliente, logado no painel, gera um código de uso
 * único (válido por 15 min) e o envia do próprio WhatsApp. Isso prova posse da
 * conta (sessão no painel) e do número (mensagem chegou dele). Depois disso,
 * as operações internas usam sempre o user_id, nunca o telefone.
 */
const CODE_TTL_MIN = 15;

export async function createLinkCode(userId: string): Promise<{ code: string; expiresAt: Date; waLink: string | null }> {
  const code = randomDigits(8);
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60_000);
  // invalida códigos anteriores
  await db().update(linkCodes).set({ usedAt: new Date() }).where(and(eq(linkCodes.userId, userId), isNull(linkCodes.usedAt)));
  await db().insert(linkCodes).values({ userId, codeHash: hmac(code, "link"), expiresAt });
  const num = env().WHATSAPP_BUSINESS_NUMBER;
  const waLink = num ? `https://wa.me/${num}?text=${encodeURIComponent(`Vincular ${code}`)}` : null;
  return { code, expiresAt, waLink };
}

export function extractLinkCode(text: string | null): string | null {
  if (!text) return null;
  const m = text.match(/\b(?:vincular|c[oó]digo|codigo|ativar)\b\D{0,10}(\d{8})\b/i) ?? text.trim().match(/^(\d{8})$/);
  return m ? m[1] : null;
}

export type LinkResult =
  | { ok: true; userId: string; name: string }
  | { ok: false; reason: "invalid_code" | "number_in_use" | "user_already_linked" };

export async function consumeLinkCode(waId: string, code: string): Promise<LinkResult> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .update(linkCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(linkCodes.codeHash, hmac(code, "link")), isNull(linkCodes.usedAt), gt(linkCodes.expiresAt, new Date())))
      .returning();
    if (!row) return { ok: false, reason: "invalid_code" } as const;
    const [existingNumber] = await tx.select().from(whatsappIdentities).where(eq(whatsappIdentities.waId, waId));
    if (existingNumber && existingNumber.userId !== row.userId) return { ok: false, reason: "number_in_use" } as const;
    const [existingUser] = await tx.select().from(whatsappIdentities).where(eq(whatsappIdentities.userId, row.userId));
    if (existingUser && existingUser.waId !== waId) {
      // troca de número: substitui o vínculo antigo
      await tx.delete(whatsappIdentities).where(eq(whatsappIdentities.userId, row.userId));
    }
    if (!existingNumber) await tx.insert(whatsappIdentities).values({ userId: row.userId, waId });
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, row.userId));
    return { ok: true, userId: row.userId, name: u?.name ?? "" } as const;
  });
}

export async function findUserByWaId(waId: string): Promise<string | null> {
  const [row] = await db().select({ userId: whatsappIdentities.userId }).from(whatsappIdentities).where(eq(whatsappIdentities.waId, waId));
  return row?.userId ?? null;
}

export async function getLinkedNumber(userId: string): Promise<string | null> {
  const [row] = await db().select({ waId: whatsappIdentities.waId }).from(whatsappIdentities).where(eq(whatsappIdentities.userId, userId));
  return row?.waId ?? null;
}

export async function unlinkNumber(userId: string) {
  await db().delete(whatsappIdentities).where(eq(whatsappIdentities.userId, userId));
}
