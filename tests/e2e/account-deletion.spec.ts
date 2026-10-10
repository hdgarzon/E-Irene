import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

test("eliminación de cuenta: exportar, solicitar con confirmación y desistir", async ({ page }) => {
  const email = `delacct_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Borrable", fullName: "Dra. Demo", email });

  await page.goto("/patients/new");
  await page.fill("#fullName", "Paciente Demo");
  await page.getByRole("button", { name: /crear paciente/i }).click();
  await expect(page.getByRole("heading", { name: "Paciente Demo" })).toBeVisible();

  // Exportación en JSON con el paciente.
  await page.goto("/settings");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /exportar datos de la clínica/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^e-irene-exportacion-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = JSON.parse(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8")));
  expect(exported.patientsExported).toBe(1);
  expect(exported.patients[0].patient.fullName).toBe("Paciente Demo");

  // Sin el nombre exacto de la clínica no se puede confirmar.
  await page.getByRole("button", { name: /solicitar la eliminación/i }).click();
  await page.fill("#confirmation", "otra clínica");
  await expect(page.getByRole("button", { name: /eliminar la cuenta en 30 días/i })).toBeDisabled();

  await page.fill("#confirmation", "Clínica Borrable");
  await page.getByRole("button", { name: /eliminar la cuenta en 30 días/i }).click();
  await expect(page.getByText(/la cuenta de la clínica se eliminará el/i)).toBeVisible();

  // El aviso se ve en el resto de la app.
  await page.goto("/patients");
  await expect(page.getByText(/la cuenta de la clínica se eliminará el/i)).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: /desistir de la eliminación/i }).click();
  await expect(page.getByRole("button", { name: /solicitar la eliminación/i })).toBeVisible();
  await expect(page.getByText(/la cuenta de la clínica se eliminará el/i)).toHaveCount(0);
});
