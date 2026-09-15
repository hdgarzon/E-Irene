import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { billingCycleBounds } from "@/lib/dates";
import { quotePlanUpgrade } from "@/lib/billing/proration";
import { PLANS } from "@/lib/plans";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";
import { LOCK_WAIT_MS, lockAcrossRuns, SUBSCRIPTION_SWEEPS_LOCK } from "./helpers/db-lock";

/**
 * Cambios de plan y cumplimiento de pagos (migración 0056), contra Supabase local.
 *
 * Lo que protegen, en términos de negocio:
 *  · un pago aprobado se aplica una sola vez, y el que no corresponde (monto,
 *    checkout de otra clínica) no activa nada y queda para reembolso;
 *  · subir de plan cobra lo cotizado y no mueve la fecha de renovación; si el
 *    plan o el período cambiaron desde la cotización, no se aplica;
 *  · bajar de plan se programa para la renovación, que cobra y aplica el plan
 *    menor; cancelar o subir anula lo programado;
 *  · nada de esto se puede invocar desde la sesión de la clínica salvo programar
 *    y anular un downgrade, y eso solo su admin.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

// Las clínicas con el período vencido de estas pruebas caen en los barridos
// globales de billing-cycle.test.ts y billing-grace.test.ts: se turnan con ellos.
let unlock: (() => Promise<void>) | undefined;
beforeAll(async () => {
  if (URL && ANON && SERVICE) unlock = await lockAcrossRuns(SUBSCRIPTION_SWEEPS_LOCK);
}, LOCK_WAIT_MS + 10_000);
afterAll(async () => {
  await unlock?.();
});

type PaidPlan = "esencial" | "pro" | "clinica";

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function bootstrapClinic() {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: signUp, error: signErr } = await client.auth.signUp({
    email,
    password: "Password123!",
  });
  expect(signErr).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: "Clínica Demo Cambios",
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  const { error: verifyErr } = await service()
    .from("users")
    .update({ verification_status: "verified" })
    .eq("id", signUp.user!.id);
  expect(verifyErr).toBeNull();
  return { client, clinicId: clinicId as string };
}

async function setClinic(clinicId: string, patch: Record<string, unknown>) {
  const { error } = await service().from("clinics").update(patch).eq("id", clinicId);
  expect(error).toBeNull();
}

async function clinicRow(clinicId: string) {
  const { data, error } = await service()
    .from("clinics")
    .select(
      "plan, billing_cycle_anchor, current_period_end, cancel_at_period_end, scheduled_plan, wompi_payment_source_id_enc",
    )
    .eq("id", clinicId)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function auditActions(clinicId: string, action: string): Promise<number> {
  const { count, error } = await service()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("action", action);
  expect(error).toBeNull();
  return count ?? 0;
}

async function fulfillment(transactionId: string) {
  const { data, error } = await service()
    .from("billing_fulfillments")
    .select("clinic_id, checkout_id, kind, outcome, reason, amount_in_cents")
    .eq("wompi_transaction_id", transactionId)
    .maybeSingle();
  expect(error).toBeNull();
  return data;
}

const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString());
const txId = () => `tx-demo-${randomUUID()}`;

const DAY = 24 * 60 * 60 * 1000;

/** Ahora truncado al segundo, como lo guarda la base. */
function nowSeconds(offsetMs = 0): Date {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000);
}

/** Clínica con un plan pago y un período vigente anclado hace 10 días. */
async function paidClinic(plan: PaidPlan, patch: Record<string, unknown> = {}) {
  const clinic = await bootstrapClinic();
  const anchor = nowSeconds(-10 * DAY).toISOString();
  const periodEnd = billingCycleBounds(anchor, new Date()).end.toISOString();
  await setClinic(clinic.clinicId, {
    plan,
    billing_status: "activo",
    billing_cycle_anchor: anchor,
    current_period_end: periodEnd,
    cancel_at_period_end: false,
    wompi_payment_source_id_enc: "enc-demo-token-previo",
    ...patch,
  });
  return { ...clinic, anchor, periodEnd };
}

async function insertCheckout(input: {
  clinicId: string;
  kind: "plan" | "upgrade";
  plan: PaidPlan;
  amountInCents: number;
  details?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await service()
    .from("billing_checkouts")
    .insert({
      wompi_payment_link_id: `test_${randomUUID()}`,
      clinic_id: input.clinicId,
      plan: input.plan,
      amount_in_cents: input.amountInCents,
      reference: `planchange-${input.clinicId}-${input.plan}-${Date.now()}`,
      kind: input.kind,
      details: input.details ?? {},
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

/** Checkout de upgrade con la cotización real para la clínica tal como está. */
async function upgradeCheckout(
  clinic: { clinicId: string; anchor: string; periodEnd: string },
  from: PaidPlan,
  to: PaidPlan,
) {
  const quote = quotePlanUpgrade({
    fromPlan: from,
    toPlan: to,
    anchor: clinic.anchor,
    periodEnd: clinic.periodEnd,
  });
  expect(quote).not.toBeNull();
  const checkoutId = await insertCheckout({
    clinicId: clinic.clinicId,
    kind: "upgrade",
    plan: to,
    amountInCents: quote!.amountInCents,
    details: { from_plan: from, to_plan: to, period_end: quote!.periodEnd },
  });
  return { checkoutId, amount: quote!.amountInCents };
}

d("compra de un plan (fulfill_plan_purchase)", () => {
  const price = PLANS.pro.priceInCents!;

  it("se aplica una sola vez por transacción, aunque llegue dos veces", async () => {
    const { clinicId } = await bootstrapClinic();
    const tx = txId();
    const args = {
      p_clinic: clinicId,
      p_transaction_id: tx,
      p_plan: "pro",
      p_amount: price,
      p_expected_amount: price,
      p_payment_source_enc: "enc-demo-token",
    };

    const first = await service().rpc("fulfill_plan_purchase", args);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ outcome: "applied", plan: "pro", already_processed: false });
    const afterFirst = await clinicRow(clinicId);
    expect(afterFirst.plan).toBe("pro");
    expect(afterFirst.wompi_payment_source_id_enc).toBe("enc-demo-token");

    // El webhook y la reconciliación al volver del checkout llegan los dos.
    const second = await service().rpc("fulfill_plan_purchase", args);
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ outcome: "applied", already_processed: true });

    expect(await auditActions(clinicId, "subscription.activated")).toBe(1);
    expect(await fulfillment(tx)).toMatchObject({ outcome: "applied", kind: "plan" });
  });

  it("SEGURIDAD: un monto que no es el precio no activa nada y queda para reembolso", async () => {
    const { clinicId } = await bootstrapClinic();
    const tx = txId();
    const args = {
      p_clinic: clinicId,
      p_transaction_id: tx,
      p_plan: "clinica",
      p_amount: 100,
      p_expected_amount: PLANS.clinica.priceInCents,
    };

    const { data, error } = await service().rpc("fulfill_plan_purchase", args);
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "rejected", reason: "monto_no_coincide_con_el_plan" });
    expect((await clinicRow(clinicId)).plan).toBe("free");
    expect(await fulfillment(tx)).toMatchObject({ outcome: "rejected", amount_in_cents: 100 });
    expect(await auditActions(clinicId, "billing.payment_rejected")).toBe(1);

    // Reintentarlo no lo aplica ni lo vuelve a reportar.
    const retry = await service().rpc("fulfill_plan_purchase", args);
    expect(retry.data).toMatchObject({ outcome: "rejected", already_processed: true });
    expect(await auditActions(clinicId, "billing.payment_rejected")).toBe(1);
  });

  it("SEGURIDAD: un plan sin precio fijo (Enterprise) nunca se activa con un pago", async () => {
    const { clinicId } = await bootstrapClinic();
    const { data, error } = await service().rpc("fulfill_plan_purchase", {
      p_clinic: clinicId,
      p_transaction_id: txId(),
      p_plan: "enterprise",
      p_amount: 24_900_000,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "rejected", reason: "plan_sin_precio_fijo" });
    expect((await clinicRow(clinicId)).plan).toBe("free");
  });

  it("SEGURIDAD: el checkout de otra clínica no activa nada en esta", async () => {
    const mine = await bootstrapClinic();
    const other = await bootstrapClinic();
    const otherCheckout = await insertCheckout({
      clinicId: other.clinicId,
      kind: "plan",
      plan: "pro",
      amountInCents: price,
    });

    const { data } = await service().rpc("fulfill_plan_purchase", {
      p_clinic: mine.clinicId,
      p_transaction_id: txId(),
      p_checkout_id: otherCheckout,
      p_plan: "pro",
      p_amount: price,
      p_expected_amount: price,
    });
    expect(data).toMatchObject({ outcome: "rejected", reason: "checkout_no_corresponde" });
    expect((await clinicRow(mine.clinicId)).plan).toBe("free");
  });

  it("un checkout inexistente queda rechazado sin romper el registro", async () => {
    // Lanzar aquí haría que Wompi reintentara el mismo pago sin fin.
    const { clinicId } = await bootstrapClinic();
    const tx = txId();
    const { data, error } = await service().rpc("fulfill_plan_purchase", {
      p_clinic: clinicId,
      p_transaction_id: tx,
      p_checkout_id: randomUUID(),
      p_plan: "pro",
      p_amount: price,
      p_expected_amount: price,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "rejected", reason: "checkout_no_corresponde" });
    expect(await fulfillment(tx)).toMatchObject({ outcome: "rejected", checkout_id: null });
  });

  it("SEGURIDAD: la sesión de la clínica no puede aplicar pagos ni renovar", async () => {
    const { client, clinicId } = await paidClinic("esencial");
    const purchase = await client.rpc("fulfill_plan_purchase", {
      p_clinic: clinicId,
      p_transaction_id: txId(),
      p_plan: "clinica",
      p_amount: 1,
      p_expected_amount: 1,
    });
    expect(purchase.error).not.toBeNull();

    const upgrade = await client.rpc("apply_plan_upgrade", {
      p_clinic: clinicId,
      p_transaction_id: txId(),
      p_checkout_id: randomUUID(),
      p_amount: 1,
    });
    expect(upgrade.error).not.toBeNull();

    const row = await clinicRow(clinicId);
    const renew = await client.rpc("renew_subscription_period", {
      p_clinic: clinicId,
      p_charged_period_end: row.current_period_end,
      p_charged_plan: "esencial",
    });
    expect(renew.error).not.toBeNull();

    expect(await clinicRow(clinicId)).toEqual(row);
  });
});

d("upgrade prorrateado (apply_plan_upgrade)", () => {
  it("sube el plan sin mover la renovación y anula el downgrade programado", async () => {
    const clinic = await paidClinic("pro", { scheduled_plan: "esencial" });
    const { checkoutId, amount } = await upgradeCheckout(clinic, "pro", "clinica");
    const tx = txId();
    const args = {
      p_clinic: clinic.clinicId,
      p_transaction_id: tx,
      p_checkout_id: checkoutId,
      p_amount: amount,
    };

    const { data, error } = await service().rpc("apply_plan_upgrade", args);
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "applied", plan: "clinica", already_processed: false });

    const row = await clinicRow(clinic.clinicId);
    expect(row.plan).toBe("clinica");
    expect(iso(row.billing_cycle_anchor)).toBe(clinic.anchor);
    expect(iso(row.current_period_end)).toBe(clinic.periodEnd);
    expect(row.scheduled_plan).toBeNull();
    // Sin token nuevo se conserva el que cobra la renovación.
    expect(row.wompi_payment_source_id_enc).toBe("enc-demo-token-previo");

    const retry = await service().rpc("apply_plan_upgrade", args);
    expect(retry.data).toMatchObject({ outcome: "applied", already_processed: true });
    expect(await auditActions(clinic.clinicId, "subscription.upgraded")).toBe(1);
    expect(await fulfillment(tx)).toMatchObject({ kind: "upgrade", outcome: "applied" });
  });

  it("pagar un plan mayor anula la cancelación pedida", async () => {
    const clinic = await paidClinic("esencial", {
      cancel_at_period_end: true,
      cancel_requested_at: new Date().toISOString(),
    });
    const { checkoutId, amount } = await upgradeCheckout(clinic, "esencial", "pro");

    const { data } = await service().rpc("apply_plan_upgrade", {
      p_clinic: clinic.clinicId,
      p_transaction_id: txId(),
      p_checkout_id: checkoutId,
      p_amount: amount,
    });
    expect(data).toMatchObject({ outcome: "applied", plan: "pro" });
    const row = await clinicRow(clinic.clinicId);
    expect(row.cancel_at_period_end).toBe(false);
    expect(iso(row.current_period_end)).toBe(clinic.periodEnd);
  });

  const rejections: [
    reason: string,
    arrange: () => Promise<{ clinicId: string; checkoutId: string; amount: number; plan: string }>,
  ][] = [
    [
      "monto_no_coincide_con_la_cotizacion",
      async () => {
        const clinic = await paidClinic("esencial");
        const { checkoutId, amount } = await upgradeCheckout(clinic, "esencial", "pro");
        return { clinicId: clinic.clinicId, checkoutId, amount: amount - 100, plan: "esencial" };
      },
    ],
    [
      "el_plan_cambio_desde_la_cotizacion",
      async () => {
        const clinic = await paidClinic("esencial");
        const { checkoutId, amount } = await upgradeCheckout(clinic, "esencial", "pro");
        // Otro upgrade se aplicó mientras este link seguía abierto.
        await setClinic(clinic.clinicId, { plan: "clinica" });
        return { clinicId: clinic.clinicId, checkoutId, amount, plan: "clinica" };
      },
    ],
    [
      "el_periodo_cambio_desde_la_cotizacion",
      async () => {
        const clinic = await paidClinic("esencial");
        const { checkoutId, amount } = await upgradeCheckout(clinic, "esencial", "pro");
        // La renovación avanzó el período: la diferencia cotizada ya no corresponde.
        const next = billingCycleBounds(clinic.anchor, new Date(clinic.periodEnd)).end;
        await setClinic(clinic.clinicId, { current_period_end: next.toISOString() });
        return { clinicId: clinic.clinicId, checkoutId, amount, plan: "esencial" };
      },
    ],
    [
      "el_periodo_ya_termino",
      async () => {
        const clinic = await bootstrapClinic();
        // Ciclo [hace 45 días, hace ~14 días): el período pagado terminó.
        const anchor = nowSeconds(-45 * DAY).toISOString();
        const periodEnd = billingCycleBounds(anchor, new Date(Date.now() - 40 * DAY)).end;
        expect(periodEnd.getTime()).toBeLessThan(Date.now());
        await setClinic(clinic.clinicId, {
          plan: "esencial",
          billing_status: "activo",
          billing_cycle_anchor: anchor,
          current_period_end: periodEnd.toISOString(),
        });
        const checkoutId = await insertCheckout({
          clinicId: clinic.clinicId,
          kind: "upgrade",
          plan: "pro",
          amountInCents: 1_500_000,
          details: { from_plan: "esencial", to_plan: "pro", period_end: periodEnd.toISOString() },
        });
        return { clinicId: clinic.clinicId, checkoutId, amount: 1_500_000, plan: "esencial" };
      },
    ],
    [
      "no_es_un_upgrade",
      async () => {
        const clinic = await paidClinic("pro");
        const checkoutId = await insertCheckout({
          clinicId: clinic.clinicId,
          kind: "upgrade",
          plan: "esencial",
          amountInCents: 1_500_000,
          details: { from_plan: "pro", to_plan: "esencial", period_end: clinic.periodEnd },
        });
        return { clinicId: clinic.clinicId, checkoutId, amount: 1_500_000, plan: "pro" };
      },
    ],
    [
      "checkout_no_corresponde",
      async () => {
        // Un checkout de plan completo no sirve como upgrade.
        const clinic = await paidClinic("esencial");
        const amount = PLANS.pro.priceInCents!;
        const checkoutId = await insertCheckout({
          clinicId: clinic.clinicId,
          kind: "plan",
          plan: "pro",
          amountInCents: amount,
        });
        return { clinicId: clinic.clinicId, checkoutId, amount, plan: "esencial" };
      },
    ],
  ];

  it.each(rejections)("no aplica y deja para reembolso: %s", async (reason, arrange) => {
    const { clinicId, checkoutId, amount, plan } = await arrange();
    const before = await clinicRow(clinicId);
    const tx = txId();

    const { data, error } = await service().rpc("apply_plan_upgrade", {
      p_clinic: clinicId,
      p_transaction_id: tx,
      p_checkout_id: checkoutId,
      p_amount: amount,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ outcome: "rejected", reason });

    const after = await clinicRow(clinicId);
    expect(after.plan).toBe(plan);
    expect(after).toEqual(before);
    expect(await fulfillment(tx)).toMatchObject({ outcome: "rejected", reason, kind: "upgrade" });
    expect(await auditActions(clinicId, "billing.payment_rejected")).toBe(1);
  });
});

d("downgrade programado", () => {
  it("el admin lo programa para el fin del período, sin cambiar el plan hoy", async () => {
    const clinic = await paidClinic("clinica");

    const { data, error } = await clinic.client.rpc("schedule_plan_downgrade", { p_plan: "pro" });
    expect(error).toBeNull();
    expect(data.status).toBe("scheduled");
    expect(iso(data.effective_at)).toBe(clinic.periodEnd);

    const row = await clinicRow(clinic.clinicId);
    expect(row.plan).toBe("clinica");
    expect(row.scheduled_plan).toBe("pro");
    expect(iso(row.current_period_end)).toBe(clinic.periodEnd);

    const again = await clinic.client.rpc("schedule_plan_downgrade", { p_plan: "pro" });
    expect(again.data.status).toBe("already_scheduled");

    // Cambiar de idea reemplaza el destino.
    const other = await clinic.client.rpc("schedule_plan_downgrade", { p_plan: "esencial" });
    expect(other.data.status).toBe("scheduled");
    expect((await clinicRow(clinic.clinicId)).scheduled_plan).toBe("esencial");
    expect(await auditActions(clinic.clinicId, "subscription.downgrade_scheduled")).toBe(2);
  });

  it("anularlo deja la renovación con el plan actual", async () => {
    const clinic = await paidClinic("pro");
    await clinic.client.rpc("schedule_plan_downgrade", { p_plan: "esencial" });

    const { data, error } = await clinic.client.rpc("cancel_scheduled_plan_change");
    expect(error).toBeNull();
    expect(data.status).toBe("canceled");
    expect((await clinicRow(clinic.clinicId)).scheduled_plan).toBeNull();

    const again = await clinic.client.rpc("cancel_scheduled_plan_change");
    expect(again.data.status).toBe("not_scheduled");
  });

  it("rechaza lo que no es un downgrade programable", async () => {
    const clinic = await paidClinic("pro");
    const status = async (plan: string) =>
      (await clinic.client.rpc("schedule_plan_downgrade", { p_plan: plan })).data?.status;

    expect(await status("free")).toBe("invalid_plan");
    expect(await status("enterprise")).toBe("invalid_plan");
    expect(await status("pro")).toBe("not_a_downgrade");
    expect(await status("clinica")).toBe("not_a_downgrade");

    await setClinic(clinic.clinicId, { cancel_at_period_end: true });
    expect(await status("esencial")).toBe("canceling");

    await setClinic(clinic.clinicId, {
      cancel_at_period_end: false,
      current_period_end: new Date(Date.now() - DAY).toISOString(),
    });
    expect(await status("esencial")).toBe("no_active_period");

    expect((await clinicRow(clinic.clinicId)).scheduled_plan).toBeNull();
  });

  it("cancelar la suscripción anula el downgrade programado", async () => {
    const clinic = await paidClinic("clinica");
    await clinic.client.rpc("schedule_plan_downgrade", { p_plan: "esencial" });

    const { error } = await clinic.client.rpc("request_subscription_cancellation");
    expect(error).toBeNull();
    const row = await clinicRow(clinic.clinicId);
    expect(row.cancel_at_period_end).toBe(true);
    expect(row.scheduled_plan).toBeNull();
  });

  it("SEGURIDAD: sin sesión no se programa nada", async () => {
    const { error } = await anon().rpc("schedule_plan_downgrade", { p_plan: "esencial" });
    expect(error).not.toBeNull();
  });
});

d("renovación con el plan cobrado (renew_subscription_period)", () => {
  it("cobrar el plan programado lo aplica y avanza un ciclo, una sola vez", async () => {
    const clinic = await paidClinic("clinica", { scheduled_plan: "esencial" });
    const expectedEnd = billingCycleBounds(clinic.anchor, new Date(clinic.periodEnd)).end;
    const args = {
      p_clinic: clinic.clinicId,
      p_charged_period_end: clinic.periodEnd,
      p_charged_plan: "esencial",
    };

    const { data, error } = await service().rpc("renew_subscription_period", args);
    expect(error).toBeNull();
    expect(iso(data)).toBe(expectedEnd.toISOString());

    const row = await clinicRow(clinic.clinicId);
    expect(row.plan).toBe("esencial");
    expect(row.scheduled_plan).toBeNull();
    expect(iso(row.billing_cycle_anchor)).toBe(clinic.anchor);

    const retry = await service().rpc("renew_subscription_period", args);
    expect(retry.error).toBeNull();
    expect(retry.data).toBeNull();
    expect((await clinicRow(clinic.clinicId)).plan).toBe("esencial");
  });

  it("cobrar el plan vigente lo conserva y deja el downgrade para la renovación siguiente", async () => {
    // El downgrade se programó después de reservar el cobro del plan actual.
    const clinic = await paidClinic("pro", { scheduled_plan: "esencial" });
    const { error } = await service().rpc("renew_subscription_period", {
      p_clinic: clinic.clinicId,
      p_charged_period_end: clinic.periodEnd,
      p_charged_plan: "pro",
    });
    expect(error).toBeNull();
    const row = await clinicRow(clinic.clinicId);
    expect(row.plan).toBe("pro");
    expect(row.scheduled_plan).toBe("esencial");
  });

  it("un plan cobrado distinto del vigente y del programado conserva el vigente y deja constancia", async () => {
    // La clínica subió de plan mientras el cobro de la renovación estaba en curso.
    const clinic = await paidClinic("clinica");
    const { error } = await service().rpc("renew_subscription_period", {
      p_clinic: clinic.clinicId,
      p_charged_period_end: clinic.periodEnd,
      p_charged_plan: "pro",
    });
    expect(error).toBeNull();
    expect((await clinicRow(clinic.clinicId)).plan).toBe("clinica");
    expect(await auditActions(clinic.clinicId, "subscription.renewal_plan_mismatch")).toBe(1);
  });

  it("Free no se renueva por cobro", async () => {
    const clinic = await paidClinic("esencial");
    const { error } = await service().rpc("renew_subscription_period", {
      p_clinic: clinic.clinicId,
      p_charged_period_end: clinic.periodEnd,
      p_charged_plan: "free",
    });
    expect(error).not.toBeNull();
    expect((await clinicRow(clinic.clinicId)).plan).toBe("esencial");
  });
});
