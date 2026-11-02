"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { env } from "@/server/config/env";
import { replyForLinkedUser } from "@/server/whatsapp/processor";
import { rateLimit } from "@/server/security/rate-limit";
import type { Reply } from "@/server/agent/format";

/**
 * Simulador: envia uma mensagem para o MESMO agente usado no WhatsApp
 * (assinatura, limites, IA/regras, banco), sem passar pela Meta.
 */
export async function simulateMessage(input: { text?: string; buttonId?: string }): Promise<Reply> {
  if (!env().SIMULATOR_ENABLED) return { text: "O simulador está desativado nesta instalação." };
  const user = await requireUser();
  if (!(await rateLimit(`sim:${user.id}`, 20, 60))) return { text: "Muitas mensagens seguidas. Aguarde um minuto." };
  const text = input.text?.slice(0, 1000) ?? null;
  const buttonId = input.buttonId?.slice(0, 256) ?? null;
  const result = await replyForLinkedUser(
    user.id,
    `sim.${randomUUID()}`,
    { text, buttonId, type: buttonId ? "button" : "text" },
    {},
  );
  revalidatePath("/app", "layout");
  return result?.reply ?? { text: "(sem resposta — limite de mensagens atingido)" };
}
