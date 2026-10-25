import { currentUser } from "@/server/auth/session";
import { exportUserData } from "@/server/account/privacy";
import { rateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("não autenticado", { status: 401 });
  if (!(await rateLimit(`export:${user.id}`, 5, 3600))) return new Response("Muitas exportações. Tente mais tarde.", { status: 429 });
  const data = await exportUserData(user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="financezap-meus-dados.json"`, "Cache-Control": "no-store" },
  });
}
