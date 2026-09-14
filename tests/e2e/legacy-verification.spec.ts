import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Capturas opcionales para revisar la interfaz a mano; en CI no se generan.
const SHOTS_DIR = process.env.E2E_SCREENSHOTS_DIR;

test("verificación heredada: avisa el plazo y deja subir documentos sin perder acceso", async ({
  page,
}) => {
  const email = `heredada_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Heredada", fullName: "Dra. Heredada", email });

  // Deja la cuenta como la dejó el backfill de la 0032 en producción: verificada
  // sin documentos y con la "decisión" fechada en el alta.
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await admin
    .from("users")
    .update({
      verification_status: "verified",
      verification_notes:
        "Cuenta anterior a la verificación obligatoria; pendiente de revisión retroactiva.",
      verification_decided_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    })
    .eq("email", email);
  if (error) throw error;

  await page.goto("/dashboard");
  await expect(
    page.getByText(/Confirma tu habilitación profesional antes del 18 de octubre de 2026/),
  ).toBeVisible();
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/7-aviso-heredada.png` });

  await page.goto("/verificacion");
  await expect(page.getByText("Confirma tu habilitación profesional", { exact: true })).toBeVisible();
  await page.fill("#profession", "Psicología clínica");
  await page.fill("#licenseNumber", "123456");
  await page.fill("#document", "1000000000");
  const pdf = Buffer.from("%PDF-1.4 documento de prueba");
  await page.setInputFiles("#idDocument", { name: "cedula.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.setInputFiles("#licenseDocument", {
    name: "tarjeta.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/8-formulario-heredada.png`, fullPage: true });
  await page.getByRole("button", { name: "Enviar para verificación" }).click();

  await expect(page.getByText("Documentos recibidos")).toBeVisible();
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/9-documentos-recibidos.png` });

  // Con los documentos enviados, el aviso del plazo desaparece.
  await page.goto("/dashboard");
  await expect(page.getByText(/Confirma tu habilitación profesional antes del/)).toHaveCount(0);
});
