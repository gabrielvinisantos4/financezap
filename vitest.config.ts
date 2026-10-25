import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup-env.ts"],
    // Os testes compartilham um banco de teste real; rodar em sequência evita interferência
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
