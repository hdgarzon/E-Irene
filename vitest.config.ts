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
    // Antes de cualquier archivo: el Supabase local tiene que ser el de e-irene.
    globalSetup: ["./tests/helpers/global-setup.ts"],
    // En cada archivo: un 502 del gateway del Supabase local se reenvía en vez
    // de llegarle a la prueba como un error sin código.
    setupFiles: ["./tests/helpers/supabase-fetch-setup.ts"],
  },
});
