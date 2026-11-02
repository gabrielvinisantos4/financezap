import { z } from "zod";

/**
 * Configuração centralizada. Toda credencial vem de variável de ambiente;
 * nada é fixado no código. Valores opcionais deixam o módulo correspondente
 * em modo "não configurado" (o sistema avisa em vez de simular sucesso).
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("FinanceZap"),
  DEFAULT_TIMEZONE: z.string().default("America/Sao_Paulo"),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["disable", "require"]).default("disable"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  REDIS_URL: z.string().optional().transform((v) => v || undefined),

  // Modo de teste: simulador de WhatsApp no painel e período de teste automático
  SIMULATOR_ENABLED: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  AUTO_TRIAL_PLAN: z.string().optional().transform((v) => v || undefined),
  AUTO_TRIAL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  // Segredo para HMAC de tokens/códigos (mín. 32 chars em produção)
  APP_SECRET: z.string().min(16),

  // WhatsApp Cloud API (Meta)
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default("v23.0"),
  WHATSAPP_BUSINESS_NUMBER: z.string().optional(), // número exibido no wa.me (ex.: 5544999999999)
  WHATSAPP_DRY_RUN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // IA (OpenAI)
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().default(20000),
  // Preço do modelo (USD por 1M tokens) para estimar custo — ajuste conforme a tabela vigente
  OPENAI_PRICE_INPUT_PER_M: z.coerce.number().default(0.4),
  OPENAI_PRICE_OUTPUT_PER_M: z.coerce.number().default(1.6),
  // Custo estimado de cada mensagem de serviço enviada no WhatsApp (USD), para o painel de custos
  WHATSAPP_COST_PER_SERVICE_MESSAGE_USD: z.coerce.number().default(0),
  USD_BRL_RATE: z.coerce.number().default(5.5),

  // Asaas
  ASAAS_API_KEY: z.string().optional(),
  ASAAS_BASE_URL: z.string().url().default("https://api-sandbox.asaas.com/v3"),
  ASAAS_WEBHOOK_TOKEN: z.string().optional(),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).default(5),

  // Bootstrap do proprietário (usado só pelo script de seed)
  OWNER_EMAIL: z.string().email().optional(),
  OWNER_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // Na Vercel, sem APP_URL configurado, usa o domínio de produção do projeto
  const source = { ...process.env };
  if (!source.APP_URL && source.VERCEL_PROJECT_PRODUCTION_URL) source.APP_URL = `https://${source.VERCEL_PROJECT_PRODUCTION_URL}`;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.APP_SECRET.length < 32) {
    throw new Error("APP_SECRET precisa ter ao menos 32 caracteres em produção");
  }
  cached = parsed.data;
  return cached;
}

/** Só para testes: força releitura das variáveis. */
export function resetEnvCache() {
  cached = null;
}

export const integrations = {
  whatsappConfigured: () => {
    const e = env();
    return Boolean(e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_APP_SECRET && e.WHATSAPP_VERIFY_TOKEN);
  },
  openaiConfigured: () => Boolean(env().OPENAI_API_KEY),
  asaasConfigured: () => Boolean(env().ASAAS_API_KEY && env().ASAAS_WEBHOOK_TOKEN),
};
