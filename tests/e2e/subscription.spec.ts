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

test("cambio de plan: subir cobra la diferencia y bajar se programa para la renovación", async ({
  page,
}) => {
  const email = `cambio_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Cambio", fullName: "Dra. Admin", email });
  await activatePaidPlan(email);

  await page.goto("/settings/plan");
  await expect(page.getByText("consultas por ciclo").first()).toBeVisible();

  // Subir: se muestra lo que se paga hoy, no el precio completo del plan. El
  // checkout de Wompi no se recorre en e2e (billing-checkout.test.ts).
  const clinica = page.locator('[data-plan="clinica"]');
  await expect(clinica.getByRole("button", { name: /^Pagar \$[\d.]+ y cambiar$/ })).toBeVisible();
  await expect(clinica).toContainText("Diferencia por lo que queda del ciclo");

  // Bajar: sin cobro, desde la renovación.
  const esencial = page.locator('[data-plan="esencial"]');
  await expect(esencial).toContainText("Sin cobro hoy");
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/7-planes-cambio.png`, fullPage: true });
  await esencial.getByRole("button", { name: "Programar cambio a Esencial" }).click();

  await expect(page).toHaveURL(/cambio=programado/);
  await expect(page.getByRole("status")).toContainText("Cambio de plan programado");
  const panel = page.locator("#suscripcion");
  await expect(panel).toContainText("Conservas el plan Profesional hasta el");
  await expect(panel).toContainText("Ese día pasas al plan Esencial");
  await expect(esencial).toContainText("Cambio programado para el");
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/8-downgrade-programado.png`, fullPage: true });

  await page.goto("/settings");
  await expect(page.getByText(/con el plan Esencial\.$/)).toBeVisible();

  // Anularlo deja la renovación con el plan actual.
  await page.goto("/settings/plan");
  await panel.getByRole("button", { name: "Mantener plan Profesional" }).click();
  await expect(panel).toContainText("Plan Profesional · se renueva el");
  await expect(esencial.getByRole("button", { name: "Programar cambio a Esencial" })).toBeVisible();
});

test("horas adicionales: se ofrecen con un plan pago y suman al límite del ciclo", async ({ page }) => {
  const email = `bolsa_${Date.now()}@e-irene.test`;
  await signUpAndActivate(page, { clinicName: "Clínica Bolsa", fullName: "Dra. Admin", email });

  // Free no tiene horas adicionales.
  await page.goto("/settings/plan");
  await expect(page.getByText("Consumo del ciclo")).toBeVisible();
  await expect(page.locator("#horas-adicionales")).toHaveCount(0);

  const clinicId = await activatePaidPlan(email);
  await page.goto("/settings/plan");
  const offer = page.locator("#horas-adicionales");
  await expect(offer).toContainText("5 h por $25.000");
  await expect(offer.getByRole("button", { name: "Comprar 5 h" })).toBeVisible();

  // El pago aprobado se simula con la misma función que llaman el webhook y la
  // reconciliación; el checkout de Wompi no se recorre en e2e.
  const { data: checkout, error: checkoutError } = await admin()
    .from("billing_checkouts")
    .insert({
      wompi_payment_link_id: `test_e2e_${Date.now()}`,
      clinic_id: clinicId,
      plan: "pro",
      amount_in_cents: 2_500_000,
      reference: `transcriptionpack-${clinicId}-${Date.now()}`,
      kind: "transcription_pack",
      quantity: 1,
    })
    .select("id")
    .single();
  if (checkoutError) throw checkoutError;
  const { error: grantError } = await admin().rpc("grant_transcription_pack", {
    p_clinic: clinicId,
    p_transaction_id: `tx-e2e-${Date.now()}`,
    p_checkout_id: checkout.id,
    p_amount: 2_500_000,
  });
  if (grantError) throw grantError;

  await page.goto("/settings/plan");
  await expect(page.getByText("0 h / 35 h")).toBeVisible();
  await expect(page.getByText(/Incluye 5 h adicionales que vencen el/)).toBeVisible();
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/9-horas-adicionales.png`, fullPage: true });

  await page.goto("/settings");
  await expect(page.getByText("0 h / 35 h")).toBeVisible();
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
