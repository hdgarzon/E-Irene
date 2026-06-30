import { defineConfig, devices } from "@playwright/test";

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
  },
});
