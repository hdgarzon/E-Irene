import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

function signConsent(page: import("@playwright/test").Page) {
  const canvas = page.locator("canvas");
  return canvas.evaluate((el: HTMLCanvasElement) => {
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
}

test("telehealth: cita de video → iniciar videollamada → finalizar → reporte", async ({ page }) => {
  test.setTimeout(60_000);

  const email = `tele_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Tele", fullName: "Dra. Tele", email });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Tele");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Tele" })).toBeVisible();

  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await signConsent(page);
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();

  await page.goto("/appointments/new");
  await page.selectOption("#patientId", { label: "Paciente Tele" });
  await page.selectOption("#modality", "video");
  await page.fill("#scheduledAt", new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: /agendar cita/i }).click();
  await expect(page).toHaveURL(/\/appointments$/);

  await page.getByRole("button", { name: /iniciar videollamada/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);
  await expect(page.getByText(/videollamada en curso/i)).toBeVisible();

  await page.getByRole("button", { name: /finalizar consulta/i }).click();
  await expect(page).toHaveURL(/consultations\/[^/]+$/);
  await expect(page.getByText(/Apoyo clínico, no diagnóstico/)).toBeVisible({ timeout: 20_000 });
});
