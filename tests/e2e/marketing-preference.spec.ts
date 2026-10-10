import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

// Términos de Vinculación, cláusula novena: la autorización comercial es
// separada y revocable en cualquier momento.
test("comunicaciones comerciales: autorizar y retirar desde Mi cuenta", async ({ page }) => {
  const email = `mkt_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Marketing", fullName: "Dra. Demo", email });

  await page.getByRole("button", { name: "DD" }).click();
  await page.getByRole("menuitem", { name: /mi cuenta/i }).click();
  await expect(page).toHaveURL(/\/cuenta$/);

  // En el registro no se marcó la casilla opcional.
  await expect(page.getByText("no autorizadas")).toBeVisible();

  await page.getByRole("button", { name: /autorizar comunicaciones/i }).click();
  await expect(page.getByText("autorizadas", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /retirar la autorización/i }).click();
  await expect(page.getByText("no autorizadas")).toBeVisible();

  // Cada cambio queda como una aceptación nueva: registro + autorizar + retirar.
  await expect(page.getByText(/^Versión /)).toHaveCount(3);
});
