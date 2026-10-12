import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * El brief vacío tiene dos causas distintas: que no haya habido sesiones, o
 * que las haya habido y su análisis fallara. Decir "realiza la primera
 * consulta" en el segundo caso es falso, y sugiere que la IA revisó la sesión
 * y no encontró nada — cuando no llegó a mirarla.
 */
test("brief: distingue 'sin sesiones' de 'el análisis falló'", async ({ page }) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const email = `brief_${stamp}@e-irene.test`;
  await signUpAndActivate(page, {
    clinicName: `Clínica Brief ${stamp}`,
    fullName: `Dra. Brief ${stamp}`,
    email,
  });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Brief");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Brief" })).toBeVisible();
  const patientId = /\/patients\/([^/?]+)/.exec(page.url())?.[1];
  expect(patientId).toBeTruthy();

  // Sin consultas: el mensaje invita a hacer la primera.
  await page.goto(`/patients/${patientId}/brief`);
  await expect(page.getByText(/Realiza la primera consulta/)).toBeVisible();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile } = await admin
    .from("users")
    .select("id, clinic_id")
    .eq("email", email)
    .single();
  const { error } = await admin.from("consultations").insert({
    clinic_id: profile!.clinic_id,
    patient_id: patientId!,
    doctor_id: profile!.id,
    status: "ended",
    analysis_status: "failed",
    analysis_error: "OpenAI respondió 429: insufficient_quota",
  });
  expect(error).toBeNull();

  // Con una consulta sin analizar: el vacío se atribuye al fallo, no a la
  // ausencia de sesiones.
  await page.goto(`/patients/${patientId}/brief`);
  await expect(page.getByText(/no pudo analizarse/)).toBeVisible();
  await expect(page.getByText(/no porque no haya hallazgos/)).toBeVisible();
  await expect(page.getByText(/Realiza la primera consulta/)).toHaveCount(0);
});
