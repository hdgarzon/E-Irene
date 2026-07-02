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

  // 3. Crea un paciente, con antecedentes y contacto de emergencia
  await page.goto("/patients/new");
  await page.fill("#fullName", "Juan Pérez E2E");
  await page.fill("#document", "CC987654");
  await page.fill("#phone", "3007654321");
  await page.fill("#history", "Hipertensión controlada, sin alergias conocidas.");
  await page.fill("#emergencyContactName", "María Pérez");
  await page.fill("#emergencyContactPhone", "3011112222");
  await page.fill("#emergencyContactRelationship", "Madre");
  await page.getByRole("button", { name: /crear paciente/i }).click();

  // 4. Ficha del paciente con sus datos descifrados
  await expect(page.getByRole("heading", { name: "Juan Pérez E2E" })).toBeVisible();
  await expect(page.getByText("CC987654")).toBeVisible();
  await expect(page.getByText(/Hipertensión controlada/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contacto de emergencia" })).toBeVisible();
  await expect(page.getByText("María Pérez")).toBeVisible();
  await expect(page.getByText("3011112222")).toBeVisible();
  await expect(page.getByText("Madre")).toBeVisible();

  // 5. Aplica el PHQ-9 (escala psicométrica)
  await page.getByRole("link", { name: /Aplicar PHQ/i }).click();
  await expect(page).toHaveURL(/assessments\/new\?type=phq9/);
  const fieldsets = page.locator("fieldset");
  await expect(fieldsets).toHaveCount(9);
  for (let i = 0; i < 9; i++) {
    await fieldsets.nth(i).locator('input[type="radio"][value="1"]').click();
  }
  await page.getByRole("button", { name: /guardar resultado/i }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole("heading", { name: "Evolución PHQ-9 (depresión)" })).toBeVisible();
  await expect(page.getByText("9/27 · Leve")).toBeVisible();

  // El último resultado aparece también en la ficha del paciente
  const patientId = page.url().match(/patients\/([^/]+)/)![1];
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByText(/Último: 9\/27 · Leve/)).toBeVisible();

  // 6. Plan de tratamiento: crear, agregar objetivo, marcarlo logrado
  await page.fill('input[name="title"]', "Manejo de ansiedad social");
  await page.getByRole("button", { name: /crear plan/i }).click();
  await expect(page.getByText("Manejo de ansiedad social")).toBeVisible();

  await page.fill('input[name="description"]', "Practicar respiración diafragmática a diario");
  await page.getByRole("button", { name: /agregar/i }).click();
  await expect(page.getByText("Practicar respiración diafragmática a diario")).toBeVisible();

  await page.getByRole("button", { name: /cambiar estado/i }).click();
  await expect(
    page.getByText("Practicar respiración diafragmática a diario"),
  ).toHaveClass(/line-through/);

  // 7. Aparece en la lista
  await page.goto("/patients");
  await expect(page.getByRole("link", { name: "Juan Pérez E2E" })).toBeVisible();
});

test("rutas protegidas redirigen a login sin sesión", async ({ page }) => {
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/login/);
});
