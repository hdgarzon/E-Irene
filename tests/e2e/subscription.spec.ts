import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signUpAndActivate } from "./helpers/signup";

const SUPABASE_URL = "http://127.0.0.1:54321";
// Capturas opcionales para revisar la interfaz a mano; en CI no se generan.
const SHOTS_DIR = process.env.E2E_SCREENSHOTS_DIR;
const DAY = 24 * 60 * 60 * 1000;

function admin() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Activa un plan pago como lo hace un pago aprobado: la misma función que llaman
 * el webhook y la reconciliación (activate_subscription, migración 0041). El
 * checkout de Wompi no se puede recorrer en e2e; está cubierto con Wompi
 * simulado en tests/billing-checkout.test.ts. Devuelve el id de la clínica.
 */
async function activatePaidPlan(email: string): Promise<string> {
  const { data: user, error } = await admin()
    .from("users")
    .select("clinic_id")
    .eq("email", email)
    .single();
  if (error) throw error;
  const { error: rpcError } = await admin().rpc("activate_subscription", {
    p_clinic: user.clinic_id,
    p_plan: "pro",
  });
  if (rpcError) throw rpcError;
  return user.clinic_id as string;
}

test("suscripción: cancelar conserva el plan hasta el fin del período y se puede reactivar", async ({
  page,
}) => {
  const email = `sub_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Suscripción", fullName: "Dra. Admin", email });
  await activatePaidPlan(email);

  await page.goto("/settings/plan");
  const panel = page.locator("#suscripcion");
  await expect(panel).toContainText("Plan Profesional · se renueva el");
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
  await expect(panel).toContainText("Conservas el plan Profesional hasta el");
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

test("suscripción: una renovación sin cobrar avisa hasta cuándo dura la gracia y ofrece pagar", async ({
  page,
}) => {
  const email = `gracia_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Gracia", fullName: "Dra. Admin", email });
  const clinicId = await activatePaidPlan(email);

  // El período venció hace 2 días y el cobro no pasó: le quedan 3 de gracia.
  const { error } = await admin()
    .from("clinics")
    .update({
      billing_status: "vencido",
      current_period_end: new Date(Date.now() - 2 * DAY).toISOString(),
    })
    .eq("id", clinicId);
  if (error) throw error;

  await page.goto("/dashboard");
  await expect(
    page.getByText("No se pudo cobrar la renovación del plan Profesional"),
  ).toBeVisible();
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/5-aviso-dashboard.png` });

  await page.goto("/settings/plan");
  const panel = page.locator("#suscripcion");
  await expect(panel).toContainText("no se ha podido cobrar. Conservas el plan hasta el");
  await expect(panel.getByRole("button", { name: "Pagar ahora" })).toBeVisible();
  await expect(page.getByText(/si no se paga la renovación/)).toBeVisible();
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/6-gracia-plan.png`, fullPage: true });
});
