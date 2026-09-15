import { defineConfig, devices } from "@playwright/test";
import { E2E_DAILY_WEBHOOK_HMAC } from "./tests/e2e/helpers/daily";

// Carga .env.local en process.env del test runner (no del webServer, que ya
// lo hace Next.js por su cuenta) — algunos specs necesitan SUPABASE_SERVICE_ROLE_KEY
// directamente (p. ej. para preparar datos de prueba fuera del flujo normal de la app).
try {
  process.loadEnvFile(".env.local");
} catch {
  // Si no existe .env.local (p. ej. en CI, donde las env vars ya vienen del workflow), se ignora.
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // Antes de cualquier spec, el candado de máquina sobre el Supabase local: el
  // mismo que toma vitest, para no correr a la vez que otra suite.
  globalSetup: "./tests/e2e/helpers/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    // Fuerza los proveedores mock para la suite de regresión: determinista,
    // sin red ni costo, sin importar si .env.local trae API keys reales.
    // (Process env tiene prioridad sobre .env.local en Next.js.)
    // RATE_LIMITING_DISABLED: todos los tests hacen signup/login desde la
    // misma IP y agotarían el límite por IP; se desactiva solo aquí.
    env: {
      ANALYSIS_PROVIDER: "mock",
      TRANSCRIPTION_PROVIDER: "mock",
      VIDEO_PROVIDER: "mock",
      RATE_LIMITING_DISABLED: "true",
      // Secreto ficticio: la suite firma eventos de Daily contra la ruta real.
      DAILY_WEBHOOK_HMAC: E2E_DAILY_WEBHOOK_HMAC,
    },
    // Sin esto, Playwright silencia la salida del dev server salvo que
    // falle el arranque — errores de Server Actions en runtime (console.error
    // dentro de una request) no llegarían a los logs de CI.
    stdout: "pipe",
    stderr: "pipe",
  },
});
