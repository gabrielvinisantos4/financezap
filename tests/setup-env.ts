// Ambiente isolado de teste: banco e Redis próprios, nenhuma credencial real.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://financezap:financezap@localhost:5432/financezap_test";
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379/15";
process.env.APP_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.APP_URL = "http://localhost:3000";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
process.env.WHATSAPP_BUSINESS_NUMBER = "5544900000000";
process.env.WHATSAPP_DRY_RUN = "true";
process.env.ASAAS_API_KEY = "test-asaas-key";
process.env.ASAAS_WEBHOOK_TOKEN = "test-asaas-webhook-token-0123456789abcdef";
delete process.env.OPENAI_API_KEY;
