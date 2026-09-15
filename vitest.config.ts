import { defineConfig } from "vitest/config";
import { isLocalSupabase } from "./tests/helpers/supabase-env";
import { releaseSupabaseLock, supabaseLockPath } from "./tests/helpers/supabase-lock";

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
  plugins: [
    {
      // global-setup.ts toma el candado del Supabase local al arrancar y en cada
      // re-ejecución; esto lo suelta al terminar cada corrida, para que un watch
      // inactivo no bloquee a otras sesiones. Va en configureVitest y no en
      // `test.reporters`: declararlos ahí reemplaza los que vitest elige solo
      // (default o agent, y github-actions en CI).
      name: "e-irene:supabase-lock",
      configureVitest({ vitest }) {
        vitest.config.reporters.push({
          onTestRunEnd() {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
            if (url && isLocalSupabase(url)) releaseSupabaseLock(supabaseLockPath(url));
          },
        });
      },
    },
  ],
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
