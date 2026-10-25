import { Queue } from "bullmq";
import { redis } from "../security/rate-limit";

export const INBOUND_QUEUE = "whatsapp-inbound";
export const MAINTENANCE_QUEUE = "maintenance";
export const INBOUND_ATTEMPTS = 4;

declare global {
  // eslint-disable-next-line no-var
  var __fzQueues: Map<string, Queue> | undefined;
}

export function queue(name: string): Queue {
  globalThis.__fzQueues ??= new Map();
  let q = globalThis.__fzQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis() });
    globalThis.__fzQueues.set(name, q);
  }
  return q;
}

/** jobId = id interno da mensagem: a fila não aceita o mesmo job duas vezes. */
export async function enqueueInbound(inboundId: string) {
  await queue(INBOUND_QUEUE).add(
    "process",
    { inboundId },
    {
      jobId: inboundId,
      attempts: INBOUND_ATTEMPTS,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  );
}

export async function closeQueues() {
  for (const q of globalThis.__fzQueues?.values() ?? []) await q.close();
  globalThis.__fzQueues = undefined;
}
