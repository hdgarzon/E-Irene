import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { addMonthsBogota, billingCycleBounds } from "@/lib/dates";
import { graceEndsAt } from "@/lib/billing/subscription-state";
import { getClinicsDueForCharge, recordUnreadablePaymentSource } from "@/lib/db/billing";
import { logger } from "@/lib/logger";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";

/**
 * Ciclo de facturación y cancelación (migración 0041), contra Supabase local.
 *
 * Lo que protegen, en términos de negocio:
 *  · la cuota se reinicia en la fecha de contratación, no el día 1;
 *  · una renovación avanza el período exactamente un ciclo, una sola vez;
 *  · cancelar conserva lo pagado hasta el fin del período, no vuelve a cobrar
 *    y no borra nada;
 *  · un token de cobro ilegible (clave rotada, dato corrupto) en una clínica no
 *    impide listar a las demás para el cobro recurrente;
 *  · el cálculo del ciclo en SQL (el que aplica la cuota) y en lib/dates.ts
 *    (el que muestra la interfaz y cuenta consultas) dan lo mismo.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function bootstrapClinic(name: string) {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: signUp, error: signErr } = await client.auth.signUp({
    email,
    password: "Password123!",
  });
  expect(signErr).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  const { error: verifyErr } = await service()
    .from("users")
    .update({ verification_status: "verified" })
    .eq("id", signUp.user!.id);
  expect(verifyErr).toBeNull();
  return { client, clinicId: clinicId as string, userId: signUp.user!.id };
}

async function setClinic(clinicId: string, patch: Record<string, unknown>) {
  const { error } = await service().from("clinics").update(patch).eq("id", clinicId);
  expect(error).toBeNull();
}

async function clinicRow(clinicId: string) {
  const { data, error } = await service()
    .from("clinics")
    .select(
      "plan, billing_status, billing_cycle_anchor, current_period_end, cancel_at_period_end, cancel_requested_at, wompi_payment_source_id_enc",
    )
    .eq("id", clinicId)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function subscriptionAudit(clinicId: string): Promise<string[]> {
  const { data, error } = await service()
    .from("audit_logs")
    .select("action")
    .eq("clinic_id", clinicId)
    .like("action", "subscription.%")
    .order("created_at", { ascending: true });
  expect(error).toBeNull();
  return (data ?? []).map((r) => r.action as string);
}

const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString());

/** Ahora truncado al segundo, como lo guarda la base. */
function nowSeconds(offsetMs = 0): Date {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000);
}

const DAY = 24 * 60 * 60 * 1000;

d("el ciclo en SQL coincide con lib/dates.ts", () => {
  const cases: [anchor: string, at: string][] = [
    ["2026-01-31T15:00:00Z", "2026-03-01T00:00:00Z"],
    ["2026-01-31T02:00:00Z", "2026-02-28T12:00:00Z"],
    ["2028-01-31T15:00:00Z", "2028-03-15T00:00:00Z"],
    ["2026-08-18T14:00:00Z", "2026-09-18T14:00:00Z"],
    ["2026-10-18T14:00:00Z", "2026-09-20T00:00:00Z"],
    ["2026-09-01T05:00:00Z", "2026-10-01T04:30:00Z"],
    ["2025-12-31T23:59:59Z", "2026-02-28T23:00:00Z"],
  ];

  it.each(cases)("ancla %s, instante %s", async (anchor, at) => {
    const { data, error } = await service().rpc("billing_cycle_bounds", {
      p_anchor: anchor,
      p_at: at,
    });
    expect(error).toBeNull();
    const [row] = data as { cycle_start: string; cycle_end: string }[];
    const ts = billingCycleBounds(anchor, new Date(at));
    expect(iso(row.cycle_start)).toBe(ts.start.toISOString());
    expect(iso(row.cycle_end)).toBe(ts.end.toISOString());
  });

  it.each([-1, 1, 2, 13])("add_billing_months con %i meses", async (months) => {
    for (const from of ["2026-01-31T02:00:00Z", "2028-01-31T15:00:00Z", "2026-03-31T15:00:00Z"]) {
      const { data, error } = await service().rpc("add_billing_months", {
        p_from: from,
        p_months: months,
      });
      expect(error).toBeNull();
      expect(iso(data as string)).toBe(addMonthsBogota(from, months).toISOString());
    }
  });
});

d("la cuota de transcripción corta por ciclo, no por mes calendario", () => {
  it("solo cuenta las sesiones que empezaron en el ciclo vigente", async () => {
    const A = await bootstrapClinic("Clínica Ciclo Cuota");
    const anchor = nowSeconds(-10 * DAY);
    await setClinic(A.clinicId, { billing_cycle_anchor: anchor.toISOString() });

    const { error } = await service()
      .from("transcription_usage")
      .insert([
        {
          clinic_id: A.clinicId,
          consultation_id: randomUUID(),
          started_at: new Date(anchor.getTime() - 60 * 60 * 1000).toISOString(),
          seconds: 3000,
          finalized_at: new Date(anchor.getTime() - 30 * 60 * 1000).toISOString(),
        },
        {
          clinic_id: A.clinicId,
          consultation_id: randomUUID(),
          started_at: new Date(anchor.getTime() + 60 * 60 * 1000).toISOString(),
          seconds: 1200,
          finalized_at: new Date(anchor.getTime() + 90 * 60 * 1000).toISOString(),
        },
      ]);
    expect(error).toBeNull();

    const { data, error: usageErr } = await A.client.rpc("get_transcription_usage");
    expect(usageErr).toBeNull();
    expect(data).toEqual({ used_seconds: 1200, sessions: 1 });
  }, 30000);
});

d("suscripción: activación, renovación y cancelación", () => {
  let B: { client: SupabaseClient; clinicId: string; userId: string };
  let patientId: string;

  beforeAll(async () => {
    B = await bootstrapClinic("Clínica Suscripción");
    const { data, error } = await B.client
      .from("patients")
      .insert({ clinic_id: B.clinicId, full_name_enc: encrypt("Paciente Demo") })
      .select("id")
      .single();
    expect(error).toBeNull();
    patientId = data!.id as string;
  }, 30000);

  it("la sesión de la clínica no puede activar, renovar ni barrer suscripciones", async () => {
    const activate = await B.client.rpc("activate_subscription", {
      p_clinic: B.clinicId,
      p_plan: "enterprise",
      p_payment_source_enc: null,
    });
    expect(activate.error).not.toBeNull();

    const renew = await B.client.rpc("renew_subscription_period", {
      p_clinic: B.clinicId,
      p_charged_period_end: null,
    });
    expect(renew.error).not.toBeNull();

    const sweep = await B.client.rpc("end_canceled_subscriptions");
    expect(sweep.error).not.toBeNull();
    expect((await clinicRow(B.clinicId)).plan).toBe("free");
  });

  it("una clínica Free no tiene suscripción que cancelar", async () => {
    const { error } = await B.client.rpc("request_subscription_cancellation");
    expect(error).not.toBeNull();
  });

  it("pagar un plan fija el ancla en el momento del pago y el período un ciclo después", async () => {
    const before = Date.now();
    const { data, error } = await service().rpc("activate_subscription", {
      p_clinic: B.clinicId,
      p_plan: "pro",
      p_payment_source_enc: encrypt("ps-demo-1"),
    });
    expect(error).toBeNull();

    const row = await clinicRow(B.clinicId);
    expect(row.plan).toBe("pro");
    expect(row.billing_status).toBe("activo");
    expect(Math.abs(new Date(row.billing_cycle_anchor).getTime() - before)).toBeLessThan(5 * 60 * 1000);
    expect(iso(row.current_period_end)).toBe(addMonthsBogota(row.billing_cycle_anchor, 1).toISOString());
    expect(iso(data as string)).toBe(iso(row.current_period_end));
    expect(row.cancel_at_period_end).toBe(false);
    expect(await subscriptionAudit(B.clinicId)).toContain("subscription.activated");
  });

  it("renovar avanza exactamente un ciclo desde el fin cobrado, y repetirlo no hace nada", async () => {
    const row = await clinicRow(B.clinicId);
    const charged = row.current_period_end as string;

    const first = await service().rpc("renew_subscription_period", {
      p_clinic: B.clinicId,
      p_charged_period_end: charged,
    });
    expect(first.error).toBeNull();
    const expected = addMonthsBogota(row.billing_cycle_anchor, 2).toISOString();
    expect(iso(first.data as string)).toBe(expected);

    // El cron y el webhook del mismo cobro llegan los dos: el segundo es un no-op.
    const second = await service().rpc("renew_subscription_period", {
      p_clinic: B.clinicId,
      p_charged_period_end: charged,
    });
    expect(second.error).toBeNull();
    expect(second.data).toBeNull();

    const after = await clinicRow(B.clinicId);
    expect(iso(after.current_period_end)).toBe(expected);
    expect(iso(after.billing_cycle_anchor)).toBe(iso(row.billing_cycle_anchor));
  });

  it("un cobro que se paga pasada la gracia reinicia el ciclo hoy en vez de cobrar ciclos vencidos", async () => {
    const lapsedEnd = nowSeconds(-10 * DAY);
    await setClinic(B.clinicId, {
      current_period_end: lapsedEnd.toISOString(),
      billing_cycle_anchor: addMonthsBogota(lapsedEnd, -1).toISOString(),
      billing_status: "vencido",
    });

    const before = Date.now();
    const { data, error } = await service().rpc("renew_subscription_period", {
      p_clinic: B.clinicId,
      p_charged_period_end: lapsedEnd.toISOString(),
    });
    expect(error).toBeNull();

    const row = await clinicRow(B.clinicId);
    expect(Math.abs(new Date(row.billing_cycle_anchor).getTime() - before)).toBeLessThan(5 * 60 * 1000);
    expect(iso(row.current_period_end)).toBe(addMonthsBogota(row.billing_cycle_anchor, 1).toISOString());
    expect(iso(data as string)).toBe(iso(row.current_period_end));
    expect(row.billing_status).toBe("activo");
  });

  it("solo el admin de la clínica puede cancelar", async () => {
    await service().from("users").update({ role: "doctor" }).eq("id", B.userId);
    const { error } = await B.client.rpc("request_subscription_cancellation");
    await service().from("users").update({ role: "admin" }).eq("id", B.userId);
    expect(error).not.toBeNull();
    expect((await clinicRow(B.clinicId)).cancel_at_period_end).toBe(false);
  });

  it("cancelar conserva el plan y el token hasta el fin del período pagado", async () => {
    const row = await clinicRow(B.clinicId);
    const { data, error } = await B.client.rpc("request_subscription_cancellation");
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("scheduled");
    expect(iso((data as { effective_at: string }).effective_at)).toBe(iso(row.current_period_end));

    const after = await clinicRow(B.clinicId);
    expect(after.plan).toBe("pro");
    expect(after.cancel_at_period_end).toBe(true);
    expect(after.cancel_requested_at).not.toBeNull();
    expect(after.wompi_payment_source_id_enc).not.toBeNull();

    const again = await B.client.rpc("request_subscription_cancellation");
    expect((again.data as { status: string }).status).toBe("already_scheduled");
    expect(await subscriptionAudit(B.clinicId)).toContain("subscription.cancel_requested");
  });

  it("el cobro recurrente no toma a una clínica con la cancelación pedida", async () => {
    // Período por vencer dentro de la ventana de cobro (3 días).
    const dueSoon = nowSeconds(1 * DAY);
    await setClinic(B.clinicId, {
      current_period_end: dueSoon.toISOString(),
      billing_cycle_anchor: addMonthsBogota(dueSoon, -1).toISOString(),
    });
    const due = await getClinicsDueForCharge();
    expect(due.map((c) => c.id)).not.toContain(B.clinicId);
  });

  it("revertir antes del fin la deja renovándose como antes", async () => {
    const { data, error } = await B.client.rpc("revert_subscription_cancellation");
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("reverted");

    const row = await clinicRow(B.clinicId);
    expect(row.cancel_at_period_end).toBe(false);
    expect(row.cancel_requested_at).toBeNull();
    expect(await subscriptionAudit(B.clinicId)).toContain("subscription.cancel_reverted");

    const due = await getClinicsDueForCharge();
    expect(due.map((c) => c.id)).toContain(B.clinicId);
  });

  it("al vencer el período, el barrido la pasa a Free, borra el token y no toca los datos", async () => {
    const { error: cancelErr } = await B.client.rpc("request_subscription_cancellation");
    expect(cancelErr).toBeNull();
    const before = await clinicRow(B.clinicId);

    // Simula que llegó la fecha: el período pagado terminó hace un minuto.
    await setClinic(B.clinicId, { current_period_end: nowSeconds(-60 * 1000).toISOString() });

    const { data, error } = await service().rpc("end_canceled_subscriptions");
    expect(error).toBeNull();
    expect(data as number).toBeGreaterThanOrEqual(1);

    const row = await clinicRow(B.clinicId);
    expect(row.plan).toBe("free");
    expect(row.billing_status).toBe("sin_configurar");
    expect(row.current_period_end).toBeNull();
    expect(row.wompi_payment_source_id_enc).toBeNull();
    expect(row.cancel_at_period_end).toBe(false);
    // El ancla se conserva: la cuota Free sigue el mismo día del mes.
    expect(iso(row.billing_cycle_anchor)).toBe(iso(before.billing_cycle_anchor));

    // Cancelar no es borrar: el paciente sigue ahí y la clínica lo sigue viendo.
    const { data: patient, error: patientErr } = await B.client
      .from("patients")
      .select("id")
      .eq("id", patientId)
      .single();
    expect(patientErr).toBeNull();
    expect(patient?.id).toBe(patientId);

    expect(await subscriptionAudit(B.clinicId)).toContain("subscription.ended");
  });

  it("revertir cuando el período ya terminó no es posible", async () => {
    await service().rpc("activate_subscription", {
      p_clinic: B.clinicId,
      p_plan: "pro",
      p_payment_source_enc: encrypt("ps-demo-2"),
    });
    const { error: cancelErr } = await B.client.rpc("request_subscription_cancellation");
    expect(cancelErr).toBeNull();
    await setClinic(B.clinicId, { current_period_end: nowSeconds(-60 * 1000).toISOString() });

    const { data, error } = await B.client.rpc("revert_subscription_cancellation");
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("too_late");
  });

  it("pagar un plan anula una cancelación pendiente", async () => {
    await service().rpc("activate_subscription", {
      p_clinic: B.clinicId,
      p_plan: "pro",
      p_payment_source_enc: null,
    });
    const row = await clinicRow(B.clinicId);
    expect(row.cancel_at_period_end).toBe(false);
    expect(row.cancel_requested_at).toBeNull();
    // Sin token nuevo se conserva el que había.
    expect(row.wompi_payment_source_id_enc).not.toBeNull();
  });

  it("sin período pagado vigente (plan asignado sin pago), cancelar termina de inmediato", async () => {
    await setClinic(B.clinicId, { plan: "clinica", current_period_end: null, billing_status: "sin_configurar" });
    const { data, error } = await B.client.rpc("request_subscription_cancellation");
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("ended");
    expect((await clinicRow(B.clinicId)).plan).toBe("free");
  });
});

d("cobro recurrente: un token de cobro ilegible no impide listar a las demás clínicas", () => {
  // La base local es compartida y guarda clínicas por cobrar de otras corridas,
  // con tokens cifrados con otra ENCRYPTION_KEY. Acá se crea una a propósito:
  // así la prueba no depende de lo que haya en la base y falla igual en una nueva.
  let legible: string;
  let ilegible: string;
  let ilegibleEnc: string;

  async function dueClinic(name: string, paymentSourceEnc: string): Promise<string> {
    const { clinicId } = await bootstrapClinic(name);
    const { error } = await service().rpc("activate_subscription", {
      p_clinic: clinicId,
      p_plan: "pro",
      p_payment_source_enc: paymentSourceEnc,
    });
    expect(error).toBeNull();
    const dueSoon = nowSeconds(1 * DAY);
    await setClinic(clinicId, {
      current_period_end: dueSoon.toISOString(),
      billing_cycle_anchor: addMonthsBogota(dueSoon, -1).toISOString(),
    });
    return clinicId;
  }

  beforeAll(async () => {
    legible = await dueClinic("Clínica Token Legible", encrypt("ps-demo-legible"));
    // Cifrado con otra clave: lo que deja una rotación de ENCRYPTION_KEY.
    ilegibleEnc = encrypt("ps-demo-ilegible", randomBytes(32).toString("base64"));
    ilegible = await dueClinic("Clínica Token Ilegible", ilegibleEnc);
  }, 30000);

  // Al terminar, fuera de la ventana de cobro: que no queden como filas ajenas
  // para las corridas siguientes.
  afterAll(async () => {
    for (const id of [legible, ilegible]) {
      if (id) await setClinic(id, { current_period_end: null, wompi_payment_source_id_enc: null });
    }
  });

  it("lista a las demás y marca la del token ilegible, sin registrar el token", async () => {
    // Silencia también los tokens ilegibles de otras corridas.
    const logError = vi.spyOn(logger, "error").mockImplementation(() => {});
    try {
      const due = await getClinicsDueForCharge();
      const byId = new Map(due.map((c) => [c.id, c]));
      expect(byId.get(legible)).toMatchObject({
        wompiPaymentSourceId: "ps-demo-legible",
        paymentSourceUnreadable: false,
      });
      expect(byId.get(ilegible)).toMatchObject({
        wompiPaymentSourceId: null,
        paymentSourceUnreadable: true,
      });

      const logged = logError.mock.calls.filter(
        ([event, context]) => event === "billing.payment_source_unreadable" && context?.clinicId === ilegible,
      );
      expect(logged).toHaveLength(1);
      const line = JSON.stringify(logged[0]);
      expect(line).not.toContain(ilegibleEnc);
      expect(line).not.toContain("ps-demo-ilegible");
    } finally {
      logError.mockRestore();
    }
  });

  it("deja constancia en audit_logs una sola vez por período y no la marca morosa", async () => {
    const row = await clinicRow(ilegible);
    const clinic = {
      id: ilegible,
      plan: "pro" as const,
      currentPeriodEnd: row.current_period_end as string,
      wompiPaymentSourceId: null,
      paymentSourceUnreadable: true,
    };

    expect(await recordUnreadablePaymentSource(clinic)).toBe(true);
    // El cron corre a diario: al día siguiente no se repite la constancia.
    expect(await recordUnreadablePaymentSource(clinic)).toBe(false);

    const { data, error } = await service()
      .from("audit_logs")
      .select("metadata")
      .eq("clinic_id", ilegible)
      .eq("action", "subscription.payment_source_unreadable");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].metadata).toMatchObject({
      plan: "pro",
      period_end: clinic.currentPeriodEnd,
      grace_ends_at: graceEndsAt(clinic.currentPeriodEnd),
    });
    // Es un problema nuestro, no un pago rechazado.
    expect((await clinicRow(ilegible)).billing_status).toBe("activo");
  });
});
