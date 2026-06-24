import { test, expect } from "@playwright/test";

async function signConsent(page: import("@playwright/test").Page) {
  const canvas = page.locator("canvas");
  await canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: r.left + x, clientY: r.top + y }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 220, 120);
    fire("pointermove", 360, 90);
    fire("pointerup", 360, 90);
  });
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();
}

test("consulta: consentimiento → grabar → transcribir → finalizar", async ({ page }) => {
  const email = `cons_${Date.now()}@e-irene.test`;
  await page.goto("/signup");
  await page.fill("#clinicName", "Clínica Consulta");
  await page.fill("#fullName", "Dra. Live");
  await page.fill("#email", email);
  await page.fill("#password", "Password123!");
  await page.getByRole("button", { name: /crear cuenta/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/patients/new");
  await page.fill("#fullName", "Pedro Silva");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Pedro Silva" })).toBeVisible();

  // Consentimiento
  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await signConsent(page);
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();

  // Iniciar consulta
  await page.getByRole("link", { name: /iniciar consulta/i }).click();
  await expect(page).toHaveURL(/consultations\/new/);
  await page.getByRole("button", { name: /iniciar y grabar/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);

  // Aparecen chunks en vivo
  await expect(page.getByText(/cómo te has sentido/)).toBeVisible();
  await expect(page.getByText(/momentos aparece/)).toBeVisible();

  // Finalizar
  await page.getByRole("button", { name: /finalizar consulta/i }).click();
  await expect(page).toHaveURL(/consultations\/[^/]+$/);
  await expect(page.getByText("Transcripción")).toBeVisible();
  await expect(page.getByText(/cómo te has sentido/)).toBeVisible();
});
