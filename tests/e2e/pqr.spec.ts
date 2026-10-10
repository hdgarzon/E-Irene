import { test, expect } from "@playwright/test";

test("PQR: un visitante sin cuenta radica y recibe su número de radicado", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /peticiones, quejas y reclamos/i }).click();
  await expect(page).toHaveURL(/\/pqr$/);

  // Sin la autorización de datos no se radica (casilla sin marcar por defecto).
  await expect(page.locator('input[name="dataAuthorization"]')).not.toBeChecked();

  await page.getByLabel("Reclamo").check();
  await page.fill("#fullName", "Paciente Demo");
  await page.fill("#email", "paciente@example.com");
  await page.fill("#message", "Me cobraron dos veces la renovación del plan este mes.");
  await page.check('input[name="dataAuthorization"]');
  await page.getByRole("button", { name: /radicar solicitud/i }).click();

  await expect(page.getByText("Solicitud radicada")).toBeVisible();
  await expect(page.getByText(/^PQR-\d{4}-\d{6}$/)).toBeVisible();
  await expect(page.getByText(/respuesta a más tardar/i)).toBeVisible();
});
