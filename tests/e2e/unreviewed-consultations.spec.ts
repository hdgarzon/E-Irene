import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Capturas opcionales para revisar la interfaz a mano; en CI no se generan.
const SHOTS_DIR = process.env.E2E_SCREENSHOTS_DIR;

/**
 * Una consulta cuyo análisis falló quedó SIN revisar en busca de riesgo: la
 * detección (ideación suicida, autolesión, consumo, riesgo a terceros) sale
 * del mismo análisis. Si el dashboard no lo dice, un profesional lee "sin
 * alertas" como "sin riesgo", cuando en realidad nada se evaluó — el caso
 * real cuando el proveedor de IA está caído o sin cupo.
 */
test("dashboard: avisa que una consulta sin analizar quedó sin revisar en busca de riesgo", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const email = `sinrevisar_${stamp}@e-irene.test`;
  await signUpAndActivate(page, {
    clinicName: `Clínica Sin Revisar ${stamp}`,
    fullName: `Dra. Sin Revisar ${stamp}`,
    email,
  });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, clinic_id")
    .eq("email", email)
    .single();
  expect(profileError).toBeNull();

  // El nombre va cifrado en la app; acá basta un valor opaco porque el aviso
  // solo cuenta consultas, nunca descifra a este paciente.
  const { data: patient, error: patientError } = await admin
    .from("patients")
    .insert({ clinic_id: profile!.clinic_id, full_name_enc: `demo.${stamp}.sin-descifrar` })
    .select("id")
    .single();
  expect(patientError).toBeNull();

  // Sin este dato el dashboard se ve idéntico a una clínica sin riesgo alguno.
  const { error: consultationError } = await admin.from("consultations").insert({
    clinic_id: profile!.clinic_id,
    patient_id: patient!.id,
    doctor_id: profile!.id,
    status: "ended",
    analysis_status: "failed",
    analysis_error: "OpenAI respondió 429: insufficient_quota",
  });
  expect(consultationError).toBeNull();

  await page.goto("/dashboard");

  const aviso = page.getByRole("alert").filter({ hasText: /sin revisar en busca de riesgo/ });
  await expect(aviso).toBeVisible();
  // Lo esencial: que no se lea la ausencia de alertas como ausencia de riesgo.
  await expect(aviso).toContainText(/no significa que no haya riesgo/);

  if (SHOTS_DIR) {
    await page.screenshot({ path: `${SHOTS_DIR}/dashboard-sin-revisar.png`, fullPage: true });
  }
});
