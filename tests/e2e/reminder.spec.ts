import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

test("recordatorio de cita muestra confirmación (modo demo)", async ({ page }) => {
  const email = `rem_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Recordatorio", fullName: "Dra. Mail", email });

  // Paciente con correo
  await page.goto("/patients/new");
  await page.fill("#fullName", "Sofía Ramírez");
  await page.fill("#email", "sofia@correo.co");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Sofía Ramírez" })).toBeVisible();

  // Cita
  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Sofía Ramírez" });
  await page.fill("#scheduledAt", "2030-02-20T10:00");
  await page.getByRole("button", { name: /agendar cita/i }).click();
  await expect(page).toHaveURL(/\/appointments$/);

  // Enviar recordatorio (plan Free → correo, modo demo)
  await page.getByRole("button", { name: /enviar recordatorio/i }).click();
  await expect(page.getByText(/Recordatorio por correo simulado/)).toBeVisible();
});
