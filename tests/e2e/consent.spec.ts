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
