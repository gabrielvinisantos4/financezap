import { runDailyIfDue } from "@/server/ops/maintenance";
import { opEvent } from "@/server/ops/events";
import { sendDueReminders } from "@/server/whatsapp/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chamado pelo Cron da Vercel uma vez por dia (vercel.json). As rotinas são
 * idempotentes e rodam no máximo uma vez a cada ~20 h, então uma chamada extra não
 * faz nada. Se CRON_SECRET estiver configurado, exige o cabeçalho que a Vercel envia.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("forbidden", { status: 403 });
  try {
    const ran = await runDailyIfDue();
    const reminders = await sendDueReminders();
    return Response.json({ ok: true, ran, reminders });
  } catch (err) {
    await opEvent("error", "maintenance.daily_failed", "Falha nas rotinas diárias", { err: String(err).slice(0, 300) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
