import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

test("configuración: cambiar plan y agregar miembro al equipo", async ({ page }) => {
  const email = `set_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Config", fullName: "Dra. Admin", email });

  // Settings hub → plan Free por defecto
  await page.goto("/settings");
  await expect(page.getByText("Plan actual")).toBeVisible();
  await expect(page.getByText("Free · $0/mes")).toBeVisible();

  // Cambiar a Clínica
  await page.goto("/settings/plan");
  await page.getByRole("button", { name: "Cambiar a Clínica" }).click();
  await expect(page.getByRole("button", { name: "Cambiar a Free" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cambiar a Clínica" })).toHaveCount(0);

  // Agregar un profesional (permitido en Clínica)
  await page.goto("/settings/team");
  await page.fill("#fullName", "Dr. Nuevo Colega");
  await page.fill("#email", `colega_${Date.now()}@e-irene.test`);
  await page.fill("#password", "Password123!");
  await page.selectOption("#role", "doctor");
  await page.getByRole("button", { name: /agregar miembro/i }).click();
  await expect(page.getByText("Dr. Nuevo Colega")).toBeVisible();
});
