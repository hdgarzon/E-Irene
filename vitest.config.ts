import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // Carga .env.local (URL/keys de Supabase, ENCRYPTION_KEY) en process.env de los tests.
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
