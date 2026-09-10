import { defineConfig } from "vitest/config";

// Carga .env.local (URL/keys de Supabase, ENCRYPTION_KEY) en process.env de los
// tests, antes de que arranquen los workers, que heredan el entorno. Sin
// .env.local (CI) las variables ya vienen del workflow, y las que ya existen en
// el entorno no se pisan.
//
// Con Node y no con `loadEnv` de vite, igual que playwright.config.ts: con pnpm,
// vite es dependencia de vitest y no del proyecto, así que importarlo desde acá
// no resuelve y rompe el typecheck.
try {
  process.loadEnvFile(".env.local");
} catch {
  // Sin .env.local se usa el entorno tal cual.
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
  },
});
