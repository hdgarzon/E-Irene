import { test, expect } from "@playwright/test";
import { signUpAndActivate } from "./helpers/signup";

test("configuración: plan Free muestra upgrade pago y permite agregar miembro al equipo", async ({
  page,
}) => {
  const email = `set_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Config", fullName: "Dra. Admin", email });

  // Settings hub → plan Free por defecto
  await page.goto("/settings");
  await expect(page.getByText("Plan actual")).toBeVisible();
  await expect(page.getByText("Free · $0/mes")).toBeVisible();

  // Los planes pagos ahora requieren completar un pago real en Wompi (Fase 2
  // de facturación) — ya no es un cambio instantáneo que se pueda probar con
  // un solo click. Solo se verifica que el botón refleje eso ("Pagar y
  // cambiar a...", no "Cambiar a..."); el flujo de pago en sí se prueba en
  // tests/billing-checkout.test.ts (unitario, con Wompi mockeado).
  await page.goto("/settings/plan");
  await expect(page.getByRole("button", { name: "Pagar y cambiar a Plus" })).toBeVisible();

  // Agregar personal de secretaría — no cuenta contra el límite de
  // profesionales del plan (maxDoctors), a diferencia de admin/doctor. La
  // cuenta ya creó un admin en el signup, así que Free (límite: 1 doctor)
  // ya está en su tope; agregar otro "doctor" aquí fallaría por el plan, no
  // por lo que este test quiere probar.
  await page.goto("/settings/team");
  await page.fill("#fullName", "Secretaria Nueva");
  await page.fill("#email", `secretaria_${Date.now()}@e-irene.test`);
  await page.fill("#password", "Password123!");
  await page.selectOption("#role", "secretaria");
  await page.getByRole("button", { name: /agregar miembro/i }).click();
  await expect(page.getByText("Secretaria Nueva")).toBeVisible();
});
