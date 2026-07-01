import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

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
  await signUpAndActivate(page, { clinicName: "Clínica Consulta", fullName: "Dra. Live", email });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Pedro Silva");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Pedro Silva" })).toBeVisible();

  // Consentimiento
  await page.getByRole("link", { name: /capturar consentimiento/i }).click();
  await signConsent(page);
  await expect(page.getByText("Firmado", { exact: true })).toBeVisible();

  // Iniciar consulta, con motivo de la consulta
  await page.getByRole("link", { name: /iniciar consulta/i }).click();
  await expect(page).toHaveURL(/consultations\/new/);
  await page.fill('textarea[name="reason"]', "Episodios de ansiedad antes de reuniones de trabajo.");
  await page.getByRole("button", { name: /iniciar y grabar/i }).click();
  await expect(page).toHaveURL(/consultations\/.+\/live/);

  // Aparecen chunks en vivo
  await expect(page.getByText(/cómo te has sentido/)).toBeVisible();
  await expect(page.getByText(/momentos aparece/)).toBeVisible();

  // Finalizar → genera reporte IA
  await page.getByRole("button", { name: /finalizar consulta/i }).click();
  await expect(page).toHaveURL(/consultations\/[^/]+$/);

  // Motivo de la consulta visible en la ficha de la consulta
  await expect(page.getByRole("heading", { name: "Motivo de la consulta" })).toBeVisible();
  await expect(page.getByText(/Episodios de ansiedad antes de reuniones/)).toBeVisible();

  // Reporte IA con sus secciones + disclaimer
  await expect(page.getByText(/Apoyo clínico, no diagnóstico/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resumen ejecutivo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Análisis de sentimiento" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Nube de palabras/ })).toBeVisible();

  // Sin alertas de riesgo (transcripción demo benigna)
  await expect(page.getByText(/No se identificaron alertas de riesgo/)).toBeVisible();

  // Editar la sugerencia y validar
  await page.fill('textarea[name="suggestion"]', "Continuar con técnicas de respiración y registro de logros.");
  await page.getByRole("button", { name: /guardar sugerencia/i }).click();
  await expect(page.getByText("Guardado")).toBeVisible();

  // Notas privadas del profesional (no generadas por IA) — persisten tras recargar
  await page.fill('textarea[name="notes"]', "Paciente colabora bien, evaluar remisión a psiquiatría si no mejora.");
  await page.getByRole("button", { name: /guardar notas/i }).click();
  await expect(page.getByText("Guardado").last()).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.locator('textarea[name="notes"]')).toHaveValue(
      "Paciente colabora bien, evaluar remisión a psiquiatría si no mejora.",
    );
  }).toPass({ timeout: 15_000 });

  await page.getByRole("button", { name: /validar y firmar/i }).click();
  await expect(page.getByText(/Reporte validado el/)).toBeVisible();

  // Transcripción presente
  await expect(page.getByText("Transcripción")).toBeVisible();

  // Descargar PDF (react-pdf)
  const consultationId = page.url().match(/consultations\/([^/]+)/)![1];
  const pdf = await page.request.get(`/consultations/${consultationId}/pdf`);
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const body = await pdf.body();
  expect(body.subarray(0, 4).toString()).toBe("%PDF");

  // Historial comparativo (Fase 2)
  await page.getByRole("link", { name: /volver a la ficha del paciente/i }).click();
  await page.getByRole("link", { name: /ver evolución/i }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByText(/Evolución del sentimiento/)).toBeVisible();
  await expect(page.getByText(/1 sesión analizada/)).toBeVisible();

  // Vista global de Consultas: aparece la consulta recién analizada
  await page.goto("/consultations");
  await expect(page.getByText("Pedro Silva")).toBeVisible();
  await expect(page.getByText("Analizada", { exact: true })).toBeVisible();
  await page.getByText("Pedro Silva").click();
  await expect(page).toHaveURL(new RegExp(`/consultations/${consultationId}$`));

  // Vista global de Reportes: aparece el reporte, ya validado
  await page.goto("/reports");
  await expect(page.getByText("Pedro Silva")).toBeVisible();
  await expect(page.getByText(/Validado/)).toBeVisible();
});
