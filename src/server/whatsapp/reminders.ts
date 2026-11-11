import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db, withSystem } from "../db/client";
import { categories, inboundMessages, transactions, users, whatsappIdentities } from "../db/schema";
import { getEntitlement } from "../billing/entitlements";
import { formatBRL } from "../finance/money";
import { todayIn } from "../finance/dates";
import { opEvent } from "../ops/events";
import { sendRaw, WhatsAppSendError } from "./client";

/**
 * Lembrete de conta fixa no DIA do vencimento, uma única vez por conta.
 *
 * Regra do WhatsApp: mensagem livre só até 24 h depois da última mensagem do cliente.
 * Fora dessa janela, só com modelo aprovado pela Meta (REMINDER_TEMPLATE), que é cobrado.
 * O lembrete é marcado como enviado ANTES do envio, para nunca sair duplicado; se o envio
 * falhar, fica registrado nos eventos operacionais.
 */
export const REMINDER_TEMPLATE = { name: "lembrete_vencimento", language: "pt_BR" } as const;

type Due = { id: string; userId: string; description: string; amountCents: number; icon: string | null; kind: "income" | "expense" | string };

export function reminderText(d: Pick<Due, "description" | "amountCents" | "icon" | "kind">): string {
  const what = `${d.icon ? `${d.icon} ` : ""}*${d.description}*`;
  if (d.kind === "income") return `⏰ Lembrete: hoje é o dia de receber ${what} (${formatBRL(d.amountCents)}).\n\nQuando cair, me avise: "recebi ${d.description.toLowerCase()}".`;
  return `⏰ Lembrete: hoje vence ${what} — ${formatBRL(d.amountCents)}.\n\nQuando pagar, é só me responder: "paguei ${d.description.toLowerCase()}". Se o valor mudou, mande junto (ex.: "paguei ${d.description.toLowerCase()} 213").`;
}

/** Corpo do modelo aprovado: "Olá, {{1}}! ... hoje vence {{2}} no valor de {{3}} ... paguei {{2}}". */
export function reminderTemplateBody(to: string, firstName: string, d: Pick<Due, "description" | "amountCents">) {
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: REMINDER_TEMPLATE.name,
      language: { code: REMINDER_TEMPLATE.language },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: firstName || "tudo bem" },
            { type: "text", text: d.description.slice(0, 60) },
            { type: "text", text: formatBRL(d.amountCents) },
          ],
        },
      ],
    },
  };
}

/**
 * Envia os lembretes de hoje. `now` define o "hoje" no fuso de cada cliente e só envia
 * a partir das 8 h locais (nunca de madrugada, mesmo que a rotina rode cedo).
 */
export async function sendDueReminders(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(now));
  if (localHour < 8 || localHour >= 21) return { sent: 0, skipped: 0, failed: 0 };
  const today = todayIn("America/Sao_Paulo", now);

  // Marca e coleta numa única transação: quem marcou é quem envia (sem duplicar)
  const due = await withSystem(async (tx) => {
    const rows = await tx
      .update(transactions)
      .set({ remindedAt: now })
      .where(
        and(
          eq(transactions.status, "pending"),
          isNotNull(transactions.recurringRuleId),
          isNull(transactions.deletedAt),
          isNull(transactions.remindedAt),
          eq(transactions.dueOn, today),
        ),
      )
      .returning({ id: transactions.id, userId: transactions.userId, description: transactions.description, amountCents: transactions.amountCents, kind: transactions.kind, categoryId: transactions.categoryId });
    const out: Due[] = [];
    for (const r of rows) {
      const [c] = r.categoryId ? await tx.select({ icon: categories.icon }).from(categories).where(eq(categories.id, r.categoryId)) : [];
      out.push({ id: r.id, userId: r.userId, description: r.description, amountCents: r.amountCents, kind: r.kind, icon: c?.icon ?? null });
    }
    return out;
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const d of due) {
    const [who] = await db()
      .select({ waId: whatsappIdentities.waId, name: users.name, status: users.status })
      .from(whatsappIdentities)
      .innerJoin(users, eq(users.id, whatsappIdentities.userId))
      .where(eq(whatsappIdentities.userId, d.userId));
    if (!who || who.status !== "active") {
      skipped++;
      continue;
    }
    const ent = await getEntitlement(d.userId, now);
    if (!ent.active) {
      skipped++;
      continue;
    }
    // Conversou nas últimas 24 h? Então pode mensagem livre (gratuita)
    const [recent] = await db()
      .select({ id: inboundMessages.id })
      .from(inboundMessages)
      .where(and(eq(inboundMessages.waId, who.waId), gt(inboundMessages.receivedAt, sql`now() - interval '23 hours'`)))
      .limit(1);
    const firstName = who.name.split(" ")[0] ?? "";
    try {
      if (recent) {
        await sendRaw(who.waId, { messaging_product: "whatsapp", recipient_type: "individual", to: who.waId, type: "text", text: { preview_url: false, body: reminderText(d) } }, d.userId);
      } else {
        await sendRaw(who.waId, reminderTemplateBody(who.waId, firstName, d), d.userId);
      }
      sent++;
    } catch (err) {
      failed++;
      const msg = err instanceof WhatsAppSendError ? err.message : String(err);
      await opEvent("warn", "reminder.failed", "Lembrete de vencimento não enviado", { transactionId: d.id, error: msg.slice(0, 300), template: !recent }, d.userId);
    }
  }
  if (due.length) await opEvent("info", "reminder.run", "Lembretes de vencimento", { sent, skipped, failed });
  return { sent, skipped, failed };
}
