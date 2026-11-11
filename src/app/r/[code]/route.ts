import { NextResponse, type NextRequest } from "next/server";
import { REF_COOKIE, REF_COOKIE_DAYS, registerClick } from "@/server/affiliates/affiliates";

/** Link de indicação: agentefinancezap.com.br/r/<código> → guarda o código e abre a página inicial. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const valid = await registerClick(decodeURIComponent(code)).catch(() => null);
  const res = NextResponse.redirect(new URL("/", req.url), 302);
  if (valid) {
    res.cookies.set(REF_COOKIE, valid, { maxAge: REF_COOKIE_DAYS * 86400, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  }
  return res;
}
