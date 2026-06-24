import { test, expect } from "@playwright/test";

test("crear paciente → agendar cita → aparece en agenda → cambiar estado", async ({ page }) => {
  const email = `appt_${Date.now()}@e-irene.test`;

  // Signup
  await page.goto("/signup");
  await page.fill("#clinicName", "Clínica Citas");
  await page.fill("#fullName", "Dra. Agenda");
  await page.fill("#email", email);
  await page.fill("#password", "Password123!");
  await page.getByRole("button", { name: /crear cuenta/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Paciente
  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Cita");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Cita" })).toBeVisible();

  // Nueva cita
  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Paciente Cita" });
  await page.fill("#scheduledAt", "2030-01-15T14:30");
  await page.getByRole("button", { name: /agendar cita/i }).click();

  // Aparece en la agenda
  await expect(page).toHaveURL(/\/appointments$/);
  await expect(page.getByText("Paciente Cita")).toBeVisible();
  await expect(page.getByText("14:30")).toBeVisible();

  // Cambiar estado → Confirmada
  await page.getByRole("button", { name: /Agendada/ }).click();
  await page.getByRole("menuitem", { name: "Confirmada" }).click();
  await expect(page.getByRole("button", { name: /Confirmada/ })).toBeVisible();
});
