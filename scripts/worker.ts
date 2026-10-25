import { Worker } from "bullmq";
import { redis, closeRedis } from "../src/server/security/rate-limit";
import { INBOUND_QUEUE, INBOUND_ATTEMPTS, MAINTENANCE_QUEUE, queue, closeQueues } from "../src/server/queue/queues";
import { processInbound } from "../src/server/whatsapp/processor";
import { runBillingHousekeeping, runRecurring, runRequeue, runRetention } from "../src/server/ops/maintenance";
import { closeDb } from "../src/server/db/client";
import { env, integrations } from "../src/server/config/env";
import { log } from "../src/server/log";

/**
 * Processo separado do site: consome a fila de mensagens do WhatsApp e executa
 * as rotinas de manutenção (recorrências, retenção, assinaturas, reenfileiramento).
 */
async function main() {
  env();
  log.info(
    { whatsapp: integrations.whatsappConfigured(), openai: integrations.openaiConfigured(), asaas: integrations.asaasConfigured(), dryRun: env().WHATSAPP_DRY_RUN },
    "worker iniciando",
  );

  const inbound = new Worker(
    INBOUND_QUEUE,
    async (job) => {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? INBOUND_ATTEMPTS);
      return processInbound(job.data.inboundId as string, { finalAttempt });
    },
    { connection: redis(), concurrency: 8 },
  );
  inbound.on("failed", (job, err) => log.warn({ jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, "job falhou"));

  const maint = queue(MAINTENANCE_QUEUE);
  await maint.upsertJobScheduler("requeue", { every: 2 * 60_000 }, { name: "requeue" });
  await maint.upsertJobScheduler("billing", { every: 60 * 60_000 }, { name: "billing" });
  await maint.upsertJobScheduler("recurring", { pattern: "0 6 * * *", tz: "America/Sao_Paulo" }, { name: "recurring" });
  await maint.upsertJobScheduler("retention", { pattern: "30 3 * * *", tz: "America/Sao_Paulo" }, { name: "retention" });

  const maintenance = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      switch (job.name) {
        case "requeue":
          return runRequeue();
        case "billing":
          return runBillingHousekeeping();
        case "recurring":
          return runRecurring();
        case "retention":
          return runRetention();
      }
    },
    { connection: redis(), concurrency: 1 },
  );

  const shutdown = async () => {
    log.info("worker encerrando");
    await inbound.close();
    await maintenance.close();
    await closeQueues();
    await closeRedis();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error({ err }, "falha ao iniciar o worker");
  process.exit(1);
});
