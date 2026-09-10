import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Capturas opcionales para revisar la interfaz a mano; en CI no se generan.
const SHOTS_DIR = process.env.E2E_SCREENSHOTS_DIR;

/**
 * Activa un plan pago como lo hace un pago aprobado: la misma función que llaman
 * el webhook y la reconciliación (activate_subscription, migración 0041). El
 * checkout de Wompi no se puede recorrer en e2e; está cubierto con Wompi
 * simulado en tests/billing-checkout.test.ts.
 */
async function activatePaidPlan(email: string) {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: user, error } = await admin
    .from("users")
    .select("clinic_id")
    .eq("email", email)
    .single();
  if (error) throw error;
  const { error: rpcError } = await admin.rpc("activate_subscription", {
    p_clinic: user.clinic_id,
    p_plan: "pro",
  });
  if (rpcError) throw rpcError;
}

test("suscripción: cancelar conserva el plan hasta el fin del período y se puede reactivar", async ({
  page,
}) => {
  const email = `sub_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Suscripción", fullName: "Dra. Admin", email });
  await activatePaidPlan(email);

  await page.goto("/settings/plan");
  const panel = page.locator("#suscripcion");
  await expect(panel).toContainText("Plan Professional · se renueva el");
  await expect(page.getByText("Consumo del ciclo")).toBeVisible();
  // A Free se llega cancelando, no con un cambio de plan instantáneo que
  // perdía el resto del período ya pagado.
  await expect(page.getByRole("button", { name: "Cambiar a Free" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Cancela la suscripción para pasar a Free" }),
  ).toBeVisible();

  await panel.getByRole("button", { name: "Cancelar suscripción" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("No se borra nada");
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/1-dialogo-cancelar.png` });
  await dialog.getByRole("button", { name: "Sí, cancelar" }).click();

  await expect(panel).toContainText("Cancelaste la suscripción");
  await expect(panel).toContainText("Conservas el plan Professional hasta el");
  await expect(page.getByText(/Pasas a Free el/)).toBeVisible();
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/2-cancelada.png`, fullPage: true });

  await page.goto("/settings");
  await expect(page.getByText(/Suscripción cancelada: pasas a Free el/)).toBeVisible();
  await expect(page.getByText("Consultas del ciclo")).toBeVisible();
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/3-configuracion.png`, fullPage: true });

  await page.goto("/settings/plan");
  await panel.getByRole("button", { name: "Reactivar suscripción" }).click();
  await expect(panel).toContainText("se renueva el");
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/4-reactivada.png`, fullPage: true });
});
