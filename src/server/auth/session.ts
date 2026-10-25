import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client";
import { sessions, users, type User } from "../db/schema";
import { hmac, randomToken } from "../security/crypto";
import { env } from "../config/env";

const COOKIE = "fz_session";
const TTL_DAYS = 30;

/** Sessão no banco; o cookie guarda só um token aleatório (o banco guarda o hash). */
export async function startSession(userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86400_000);
  const h = await headers();
  await db().insert(sessions).values({
    userId,
    tokenHash: hmac(token, "session"),
    expiresAt,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent")?.slice(0, 200) ?? null,
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.tokenHash, hmac(token, "session")));
  jar.delete(COOKIE);
}

export async function endAllSessions(userId: string) {
  await db().delete(sessions).where(eq(sessions.userId, userId));
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hmac(token, "session")), gt(sessions.expiresAt, new Date())));
  if (!row || row.u.status === "deleted") return null;
  return row.u;
}

/** Área do cliente: exige login (clientes bloqueados ainda veem o painel para regularizar). */
export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/entrar");
  return u;
}

export type AdminPermission = "view_metrics" | "manage_users" | "manage_plans" | "view_pii";

const ROLE_PERMS: Record<User["role"], AdminPermission[]> = {
  user: [],
  support: ["view_metrics", "manage_users"],
  admin: ["view_metrics", "manage_users", "manage_plans"],
  owner: ["view_metrics", "manage_users", "manage_plans"],
};

export function can(u: User, perm: AdminPermission): boolean {
  if (perm === "view_pii") return u.role !== "user" && u.canViewPii;
  return ROLE_PERMS[u.role].includes(perm);
}

/** Área administrativa: só papéis administrativos; caso contrário 404 (não revela a rota). */
export async function requireAdmin(perm: AdminPermission = "view_metrics"): Promise<User> {
  const u = await currentUser();
  if (!u || !can(u, perm)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return u!;
}
