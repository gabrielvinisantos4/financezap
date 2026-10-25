import { hash, verify } from "@node-rs/argon2";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withUser } from "../db/client";
import { consents, users, type User } from "../db/schema";
import { bootstrapUserData } from "../finance/engine";
import { FinanceError } from "../finance/errors";

export const TERMS_VERSION = "2026-10-24";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(80),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  password: z
    .string()
    .min(10, "A senha precisa ter pelo menos 10 caracteres")
    .max(200)
    .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use letras e números na senha"),
  phone: z
    .string()
    .trim()
    .transform((p) => p.replace(/\D/g, ""))
    .refine((p) => /^55\d{10,11}$/.test(p) || /^\d{10,11}$/.test(p), "Telefone inválido")
    .transform((p) => (p.startsWith("55") ? p : `55${p}`))
    .optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "É preciso aceitar os termos" }) }),
});

export type SignupInput = z.infer<typeof signupSchema>;

export async function hashPassword(password: string) {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function createUser(input: SignupInput, meta: { ip?: string | null } = {}, role: User["role"] = "user"): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    [user] = await db()
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash, phoneE164: input.phone ?? null, role })
      .returning();
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new FinanceError("conflict", "Já existe uma conta com esse e-mail.");
    throw e;
  }
  await db().insert(consents).values([
    { userId: user.id, kind: "terms", version: TERMS_VERSION, ip: meta.ip ?? null },
    { userId: user.id, kind: "privacy", version: TERMS_VERSION, ip: meta.ip ?? null },
  ]);
  await withUser(user.id, (tx) => bootstrapUserData(tx, user.id));
  return user;
}

/** Verifica credenciais em tempo aproximadamente constante (mesmo para e-mail inexistente). */
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$5n3mO4Q0b7q1Yx1Q8m3o2lqv9oE0n0dJ0r5c3Qk6l2s";

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const [user] = await db()
    .select()
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`, isNull(users.deletedAt)));
  if (!user) {
    await verify(DUMMY_HASH, password).catch(() => false);
    return null;
  }
  const ok = await verify(user.passwordHash, password).catch(() => false);
  return ok ? user : null;
}

export async function getUser(id: string): Promise<User | null> {
  const [u] = await db().select().from(users).where(eq(users.id, id));
  return u ?? null;
}
