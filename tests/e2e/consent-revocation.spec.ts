import { test, expect, type Page } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

async function signConsent(page: Page) {
  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  const canvas = page.locator("canvas");
  await canvas.evaluate((el: HTMLCanvasElement) => {
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      el.dispatchEvent(
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: r.left + x, clientY: r.top + y }),
      );
    fire("pointerdown", 60, 80);
    fire("pointermove", 220, 120);
    fire("pointerup", 220, 120);
  });
  await page.check('input[name="accepted"]');
  await page.getByRole("button", { name: /firmar consentimiento/i }).click();
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();
}

// Consentimiento informado, cláusula novena: el paciente puede revocar; la
// historia se conserva y no se atiende por la plataforma hasta que firme de nuevo.
test("consentimiento: firmar, revocar y volver a firmar", async ({ page }) => {
  await signUpAndActivate(page, {
    clinicName: "Clínica Revoca",
    fullName: "Dra. Demo",
    email: `revoca_${Date.now()}@e-irene.test`,
  });
  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Demo");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Demo" })).toBeVisible();

  await signConsent(page);

  // Se abre una consulta con el consentimiento vigente, sin iniciar la transcripción.
  const patientPage = page.url();
  await page.getByRole("link", { name: /iniciar consulta/i }).click();
  await page.fill('textarea[name="reason"]', "Seguimiento.");
  await page.getByRole("button", { name: /iniciar y grabar/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);
  const liveUrl = page.url();
  await page.goto(patientPage);

  await page.getByRole("button", { name: /registrar revocación/i }).click();
  await page.fill('textarea[name="note"]', "Lo pidió en consulta");
  await page.check('input[name="confirm"]');
  await page.getByRole("button", { name: /registrar revocación/i }).click();

  await expect(page.getByText("Revocado", { exact: true })).toBeVisible();
  await expect(page.getByText(/revocó su consentimiento el .*Lo pidió en consulta/)).toBeVisible();

  // Pieza 3: la consulta que quedó abierta ya no deja iniciar la transcripción.
  await page.goto(liveUrl);
  await expect(page.getByRole("button", { name: /iniciar transcripción/i })).toBeDisabled();
  await expect(page.getByText(/no tiene un consentimiento vigente/i)).toBeVisible();
  await page.goto(patientPage);

  // Sin consentimiento vigente, iniciar una consulta lleva a firmar.
  const patientUrl = page.url();
  const patientId = patientUrl.split("/").pop();
  await page.goto(`/consultations/new?patientId=${patientId}`);
  await expect(page.getByText(/aún no tiene consentimiento firmado/i)).toBeVisible();

  await page.goto(patientUrl);
  await signConsent(page);
});
