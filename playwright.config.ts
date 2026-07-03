import { defineConfig, devices } from "@playwright/test";

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
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    // Fuerza los proveedores mock para la suite de regresión: determinista,
    // sin red ni costo, sin importar si .env.local trae API keys reales.
    // (Process env tiene prioridad sobre .env.local en Next.js.)
    env: { ANALYSIS_PROVIDER: "mock", TRANSCRIPTION_PROVIDER: "mock" },
    // Sin esto, Playwright silencia la salida del dev server salvo que
    // falle el arranque — errores de Server Actions en runtime (console.error
    // dentro de una request) no llegarían a los logs de CI.
    stdout: "pipe",
    stderr: "pipe",
  },
});
