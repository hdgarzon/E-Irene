import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Capturas opcionales para revisar la interfaz a mano; en CI no se generan.
const SHOTS_DIR = process.env.E2E_SCREENSHOTS_DIR;

const SIN_CREDITOS =
  'OpenAI respondió 429: {"error":{"message":"You have no credits remaining.","type":"insufficient_quota","code":"credit_balance_exhausted"}}';

test("canales: el análisis con IA muestra sus fallos recientes y su causa, sin el texto del error", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const email = `canales_${stamp}@e-irene.test`;
  await signUpAndActivate(page, {
    clinicName: `Clínica Canales ${stamp}`,
    fullName: `Dra. Canales ${stamp}`,
    email,
  });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, clinic_id")
    .eq("email", email)
    .single();
  expect(profileError).toBeNull();

  const { error: grantError } = await admin.from("platform_admins").insert({ user_id: profile!.id });
  expect(grantError).toBeNull();

  // Un análisis que falló porque la cuenta de OpenAI se quedó sin créditos.
  const { error: auditError } = await admin.from("audit_logs").insert({
    clinic_id: profile!.clinic_id,
    action: "report.generation_failed",
    entity_type: "consultation",
    metadata: { error: SIN_CREDITOS },
  });
  expect(auditError).toBeNull();

  await page.goto("/admin/canales");
  await expect(page.getByRole("heading", { name: "Estado de los canales" })).toBeVisible();

  // El historial es de toda la plataforma y otras pruebas generan análisis en la
  // misma base: se comprueba lo que no depende del orden entre fallos y éxitos.
  const analysis = page.locator("li", { hasText: "Análisis con IA" });
  await expect(analysis.getByText(/Fallidos: \d+ en 24 horas/)).toBeVisible();
  await expect(analysis.getByText(/OpenAI sin créditos o con la cuota agotada: \d+/)).toBeVisible();
  await expect(page.getByText(/credits remaining|insufficient_quota/)).toHaveCount(0);

  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/canales-analisis.png`, fullPage: true });
});
