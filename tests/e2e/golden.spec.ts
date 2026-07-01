import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

test("camino dorado: signup → dashboard → crear paciente → lista", async ({ page }) => {
  const email = `e2e_${Date.now()}@e-irene.test`;

  // 1. Signup vía magic link (crea clínica + admin tras activar)
  await signUpAndActivate(page, { clinicName: "Clínica E2E", fullName: "Dra. Prueba", email });

  // 2. Llega al dashboard autenticado
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(/Hola,/)).toBeVisible();
  await expect(page.getByText("Clínica E2E").first()).toBeVisible();

  // 3. Crea un paciente
  await page.goto("/patients/new");
  await page.fill("#fullName", "Juan Pérez E2E");
  await page.fill("#document", "CC987654");
  await page.fill("#phone", "3007654321");
  await page.getByRole("button", { name: /crear paciente/i }).click();

  // 4. Ficha del paciente con sus datos descifrados
  await expect(page.getByRole("heading", { name: "Juan Pérez E2E" })).toBeVisible();
  await expect(page.getByText("CC987654")).toBeVisible();

  // 5. Aparece en la lista
  await page.goto("/patients");
  await expect(page.getByRole("link", { name: "Juan Pérez E2E" })).toBeVisible();
});

test("rutas protegidas redirigen a login sin sesión", async ({ page }) => {
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/login/);
});
