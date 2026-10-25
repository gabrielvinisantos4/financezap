import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

/** HMAC-SHA256 com o segredo da aplicação (para guardar tokens/códigos só como hash). */
export function hmac(value: string, purpose: string): string {
  return createHmac("sha256", env().APP_SECRET).update(`${purpose}:${value}`).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomDigits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String(randomInt(0, 10));
  return s;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Mascara e-mails e telefones para telas administrativas sem permissão de PII. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${user.slice(0, 2)}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  return `${phone.slice(0, 4)}*****${phone.slice(-2)}`;
}
