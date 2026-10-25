import pino from "pino";

/**
 * Logs estruturados. Campos sensíveis são removidos automaticamente; nunca logar
 * texto de mensagens de clientes, valores financeiros, tokens ou senhas.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: ["password", "*.password", "token", "*.token", "authorization", "*.authorization", "text", "*.text", "body", "*.body", "amount", "*.amount", "accessToken", "*.accessToken"],
    censor: "[omitido]",
  },
  base: { app: "financezap" },
});
