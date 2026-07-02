import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

test("capturar consentimiento: pendiente → firmar → firmado", async ({ page }) => {
  const email = `consent_${Date.now()}@e-irene.test`;

  await signUpAndActivate(page, { clinicName: "Clínica Consent", fullName: "Dra. Consent", email });

  // Paciente
  await page.goto("/patients/new");
  await page.fill("#fullName", "Laura Méndez");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Laura Méndez" })).toBeVisible();

  // Estado inicial: pendiente
  await expect(page.getByText("Pendiente")).toBeVisible();

  // Capturar consentimiento
  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await expect(page).toHaveURL(/\/consent$/);

  // Dibujar la firma despachando PointerEvents reales sobre el canvas
  const canvas = page.locator("canvas");
  await canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          clientX: r.left + x,
          clientY: r.top + y,
        }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 200, 120);
    fire("pointermove", 360, 90);
    fire("pointerup", 360, 90);
  });

  // Aceptar y firmar
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();

  // Vuelve a la ficha con estado firmado
  await expect(page).toHaveURL(/\/patients\/[^/]+$/);
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();
  await expect(page.getByText(/Firmado por/)).toBeVisible();
});

test("consentimiento de menor de edad: requiere representante legal", async ({ page }) => {
  const email = `consentmenor_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Menor", fullName: "Dra. Menor", email });

  // Paciente menor de edad (10 años, calculado dinámicamente)
  const birthDate = new Date();
  birthDate.setFullYear(birthDate.getFullYear() - 10);
  const birthDateStr = birthDate.toISOString().slice(0, 10);

  await page.goto("/patients/new");
  await page.fill("#fullName", "Sofía Restrepo");
  await page.fill("#birthDate", birthDateStr);
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Sofía Restrepo" })).toBeVisible();

  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await expect(page).toHaveURL(/\/consent$/);

  // El aviso de menor de edad aparece automáticamente (sin checkbox manual)
  await expect(page.getByText(/Paciente menor de edad/)).toBeVisible();
  await expect(page.getByLabel(/Nombre del representante legal/)).toBeVisible();

  await page.fill('input[name="signerName"]', "Carolina Restrepo");
  await page.fill('input[name="representativeDocument"]', "CC1122334455");
  await page.selectOption('select[name="representativeRelationship"]', "Madre");

  const canvas = page.locator("canvas");
  await canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: r.left + x, clientY: r.top + y }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 200, 120);
    fire("pointermove", 360, 90);
    fire("pointerup", 360, 90);
  });

  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();

  await expect(page).toHaveURL(/\/patients\/[^/]+$/);
  await expect(page.getByText(/Carolina Restrepo \(representante legal — Madre\)/)).toBeVisible();
  await expect(page.getByText(/Documento del representante: CC1122334455/)).toBeVisible();
});
