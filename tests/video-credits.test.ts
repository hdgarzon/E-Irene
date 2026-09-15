import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { billingCycleBounds } from "@/lib/dates";
import { VIDEO_CALL_PRICE_IN_CENTS } from "@/lib/plans";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";

/**
 * Saldo, reservas y descuento de videollamadas (migración 0058), contra Supabase local.
 *
 * Lo que protegen, en términos de negocio:
 *  · un pack pagado suma su cantidad una sola vez, y un pago que no corresponde no
 *    suma nada;
 *  · con saldo 1, dos inicios a la vez no pasan los dos, y un inicio fallido no
 *    retiene saldo;
 *  · cada consulta descuenta una sola vez, solo si el paciente se conectó, y una
 *    reserva no se puede liberar mientras la consulta sigue en curso;
 *  · desde la sesión de una clínica nadie se descuenta, se otorga ni ve saldo ajeno.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

type Clinic = { client: SupabaseClient; clinicId: string; userId: string };
type Appointment = { appointmentId: string; patientId: string };

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

const txId = () => `tx-demo-${randomUUID()}`;

function nowSeconds(offsetMs = 0): Date {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000);
}

async function bootstrapClinic(): Promise<Clinic> {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data: signUp, error: signErr } = await client.auth.signUp({
    email,
    password: "Password123!",
  });
  expect(signErr).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: "Clínica Demo Video",
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  // Sin verificar al profesional, crear pacientes y consultas falla por RLS (0032).
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

/** Clínica con un plan y período vigente anclado hace 10 días. */
async function paidClinic(plan: "esencial" | "pro" | "clinica" | "enterprise" = "esencial") {
  const clinic = await bootstrapClinic();
  const anchor = nowSeconds(-10 * DAY).toISOString();
  await setClinic(clinic.clinicId, {
    plan,
    billing_status: "activo",
    billing_cycle_anchor: anchor,
    current_period_end: billingCycleBounds(anchor, new Date()).end.toISOString(),
  });
  return clinic;
}

async function appointment(clinic: Clinic, modality: "video" | "in_person" = "video"): Promise<Appointment> {
  const { data: patient, error: pErr } = await clinic.client
    .from("patients")
    .insert({ clinic_id: clinic.clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  expect(pErr).toBeNull();
  const { data: appt, error: aErr } = await clinic.client
    .from("appointments")
    .insert({
      clinic_id: clinic.clinicId,
      patient_id: patient!.id,
      doctor_id: clinic.userId,
      scheduled_at: new Date(Date.now() + DAY).toISOString(),
      duration_min: 50,
      modality,
    })
    .select("id")
    .single();
  expect(aErr).toBeNull();
  return { appointmentId: appt!.id as string, patientId: patient!.id as string };
}

async function startConsultation(clinic: Clinic, appt: Appointment): Promise<string> {
  const { data, error } = await clinic.client
    .from("consultations")
    .insert({
      clinic_id: clinic.clinicId,
      patient_id: appt.patientId,
      doctor_id: clinic.userId,
      appointment_id: appt.appointmentId,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function endConsultation(clinic: Clinic, consultationId: string) {
  const { error } = await clinic.client
    .from("consultations")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", consultationId);
  expect(error).toBeNull();
}

async function packCheckout(
  clinicId: string,
  quantity: number,
  overrides: { amountInCents?: number; kind?: string } = {},
): Promise<string> {
  const { data, error } = await service()
    .from("billing_checkouts")
    .insert({
      wompi_payment_link_id: `test_${randomUUID()}`,
      clinic_id: clinicId,
      plan: "esencial",
      amount_in_cents: overrides.amountInCents ?? quantity * VIDEO_CALL_PRICE_IN_CENTS,
      reference: `videopack-${clinicId}-${quantity}-${Date.now()}`,
      kind: overrides.kind ?? "video_pack",
      quantity,
      expires_at: new Date(Date.now() + DAY).toISOString(),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function grant(clinicId: string, checkoutId: string, amount: number, tx = txId()) {
  const { data, error } = await service().rpc("grant_video_pack", {
    p_clinic: clinicId,
    p_transaction_id: tx,
    p_checkout_id: checkoutId,
    p_amount: amount,
  });
  expect(error).toBeNull();
  return data as { outcome: string; reason?: string; quantity?: number; already_processed: boolean };
}

async function giveCredits(clinicId: string, quantity: 1 | 5 | 10) {
  const checkoutId = await packCheckout(clinicId, quantity);
  const result = await grant(clinicId, checkoutId, quantity * VIDEO_CALL_PRICE_IN_CENTS);
  expect(result.outcome).toBe("applied");
}

async function credits(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_video_credits");
  expect(error).toBeNull();
  const r = data as { balance: number; held: number; available: number };
  return { balance: Number(r.balance), held: Number(r.held), available: Number(r.available) };
}

async function reserve(clinic: Clinic, appointmentId: string) {
  const { data, error } = await clinic.client.rpc("reserve_video_call", {
    p_appointment_id: appointmentId,
  });
  expect(error).toBeNull();
  return data as { status: string; reservation_id?: string; available?: number };
}

async function attach(clinic: Clinic, reservationId: string, consultationId: string): Promise<boolean> {
  const { data, error } = await clinic.client.rpc("attach_video_reservation", {
    p_reservation_id: reservationId,
    p_consultation_id: consultationId,
  });
  expect(error).toBeNull();
  return data as boolean;
}

/** Cita por video iniciada con su reserva enlazada, como startVideoConsultationAction. */
async function startedVideoCall(clinic: Clinic) {
  const appt = await appointment(clinic);
  const reservation = await reserve(clinic, appt.appointmentId);
  expect(reservation.status).toBe("reserved");
  const consultationId = await startConsultation(clinic, appt);
  expect(await attach(clinic, reservation.reservation_id!, consultationId)).toBe(true);
  return { ...appt, consultationId, reservationId: reservation.reservation_id! };
}

async function reservationStatus(clinic: Clinic, consultationId: string) {
  const { data, error } = await clinic.client.rpc("get_video_reservation_status", {
    p_consultation_id: consultationId,
  });
  expect(error).toBeNull();
  return data as string | null;
}

async function consume(consultationId: string, joinedAt?: string) {
  const { data, error } = await service().rpc("consume_video_call", {
    p_consultation_id: consultationId,
    p_source: "prueba",
    p_joined_at: joinedAt,
  });
  expect(error).toBeNull();
  return (data as { status: string }).status;
}

async function release(clinic: Clinic, consultationId: string) {
  const { data, error } = await clinic.client.rpc("release_video_call", {
    p_consultation_id: consultationId,
    p_reason: "paciente_no_se_conecto",
  });
  expect(error).toBeNull();
  return data as boolean;
}

async function ledger(clinicId: string) {
  const { data, error } = await service()
    .from("video_credit_ledger")
    .select("id, delta, reason, consultation_id")
    .eq("clinic_id", clinicId);
  expect(error).toBeNull();
  return data ?? [];
}

async function auditCount(clinicId: string, action: string): Promise<number> {
  const { count, error } = await service()
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("action", action);
  expect(error).toBeNull();
  return count ?? 0;
}

d("compra de packs (grant_video_pack)", () => {
  it("suma la cantidad al saldo una sola vez por transacción", async () => {
    const clinic = await paidClinic();
    const checkoutId = await packCheckout(clinic.clinicId, 5);
    const tx = txId();

    const first = await grant(clinic.clinicId, checkoutId, 5 * VIDEO_CALL_PRICE_IN_CENTS, tx);
    expect(first).toMatchObject({ outcome: "applied", quantity: 5, already_processed: false });
    // El webhook y la reconciliación al volver del checkout llegan los dos.
    const retry = await grant(clinic.clinicId, checkoutId, 5 * VIDEO_CALL_PRICE_IN_CENTS, tx);
    expect(retry).toMatchObject({ outcome: "applied", already_processed: true });

    expect(await credits(clinic.client)).toEqual({ balance: 5, held: 0, available: 5 });
    expect(await ledger(clinic.clinicId)).toEqual([
      expect.objectContaining({ delta: 5, reason: "purchase" }),
    ]);
    expect(await auditCount(clinic.clinicId, "billing.video_pack_granted")).toBe(1);
  });

  it("el precio que valida la base es el que se vende en lib/plans.ts", async () => {
    const { data, error } = await service().rpc("video_call_price_cents");
    expect(error).toBeNull();
    expect(Number(data)).toBe(VIDEO_CALL_PRICE_IN_CENTS);
  });

  const rejections: [
    reason: string,
    arrange: () => Promise<{ clinicId: string; checkoutId: string; amount: number }>,
  ][] = [
    [
      "cantidad_invalida",
      async () => {
        const { clinicId } = await paidClinic();
        return { clinicId, checkoutId: await packCheckout(clinicId, 3), amount: 3 * VIDEO_CALL_PRICE_IN_CENTS };
      },
    ],
    [
      "monto_no_coincide_con_la_compra",
      async () => {
        // Un checkout de 5 con el monto de 1: pagó $9.000 por $45.000.
        const { clinicId } = await paidClinic();
        const checkoutId = await packCheckout(clinicId, 5, { amountInCents: VIDEO_CALL_PRICE_IN_CENTS });
        return { clinicId, checkoutId, amount: VIDEO_CALL_PRICE_IN_CENTS };
      },
    ],
    [
      "checkout_no_corresponde",
      async () => {
        const mine = await paidClinic();
        const other = await paidClinic();
        return {
          clinicId: mine.clinicId,
          checkoutId: await packCheckout(other.clinicId, 1),
          amount: VIDEO_CALL_PRICE_IN_CENTS,
        };
      },
    ],
    [
      "checkout_no_corresponde",
      async () => {
        const { clinicId } = await paidClinic();
        const checkoutId = await packCheckout(clinicId, 1, { kind: "transcription_pack" });
        return { clinicId, checkoutId, amount: VIDEO_CALL_PRICE_IN_CENTS };
      },
    ],
    [
      "el_plan_no_admite_video",
      async () => {
        const { clinicId } = await bootstrapClinic();
        return { clinicId, checkoutId: await packCheckout(clinicId, 1), amount: VIDEO_CALL_PRICE_IN_CENTS };
      },
    ],
    [
      "el_plan_no_admite_video",
      async () => {
        // Enterprise incluye video: no se le vende saldo.
        const { clinicId } = await paidClinic("enterprise");
        return { clinicId, checkoutId: await packCheckout(clinicId, 1), amount: VIDEO_CALL_PRICE_IN_CENTS };
      },
    ],
  ];

  it.each(rejections)("no suma saldo y deja para reembolso: %s", async (reason, arrange) => {
    const { clinicId, checkoutId, amount } = await arrange();
    const tx = txId();

    expect(await grant(clinicId, checkoutId, amount, tx)).toMatchObject({ outcome: "rejected", reason });
    expect(await ledger(clinicId)).toHaveLength(0);
    const { data: fulfillment } = await service()
      .from("billing_fulfillments")
      .select("kind, outcome, reason")
      .eq("wompi_transaction_id", tx)
      .single();
    expect(fulfillment).toEqual({ kind: "video_pack", outcome: "rejected", reason });
  });
});

d("reserva al iniciar (reserve_video_call)", () => {
  it("sin saldo no reserva", async () => {
    const clinic = await paidClinic();
    const appt = await appointment(clinic);
    expect(await reserve(clinic, appt.appointmentId)).toEqual({ status: "insufficient", available: 0 });
  });

  it("con saldo 1, dos inicios a la vez reservan solo uno", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const [a, b] = [await appointment(clinic), await appointment(clinic)];

    const results = await Promise.all([reserve(clinic, a.appointmentId), reserve(clinic, b.appointmentId)]);

    expect(results.map((r) => r.status).sort()).toEqual(["insufficient", "reserved"]);
    expect(await credits(clinic.client)).toEqual({ balance: 1, held: 1, available: 0 });
  });

  it("un doble clic reusa la reserva abierta de la cita", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 5);
    const appt = await appointment(clinic);

    const first = await reserve(clinic, appt.appointmentId);
    const second = await reserve(clinic, appt.appointmentId);

    expect(second.reservation_id).toBe(first.reservation_id);
    expect(await credits(clinic.client)).toEqual({ balance: 5, held: 1, available: 4 });
  });

  it("enlazada a su consulta, retiene saldo mientras la consulta sigue en curso", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const call = await startedVideoCall(clinic);

    expect(await reservationStatus(clinic, call.consultationId)).toBe("held");
    expect(await credits(clinic.client)).toEqual({ balance: 1, held: 1, available: 0 });

    // No se enlaza dos veces ni con la consulta de otra cita.
    const other = await appointment(clinic);
    const otherConsultation = await startConsultation(clinic, other);
    expect(await attach(clinic, call.reservationId, otherConsultation)).toBe(false);
  });

  it("un inicio que falla libera su reserva y devuelve el saldo", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const appt = await appointment(clinic);
    const reservation = await reserve(clinic, appt.appointmentId);

    const { data, error } = await clinic.client.rpc("release_video_reservation", {
      p_reservation_id: reservation.reservation_id,
      p_reason: "fallo_al_iniciar",
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await credits(clinic.client)).toEqual({ balance: 1, held: 0, available: 1 });
  });

  it("una reserva que nunca enlazó su consulta deja de retener saldo", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const stale = await appointment(clinic);
    const reservation = await reserve(clinic, stale.appointmentId);
    const { error } = await service()
      .from("video_call_reservations")
      .update({ created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() })
      .eq("id", reservation.reservation_id);
    expect(error).toBeNull();

    expect((await credits(clinic.client)).available).toBe(1);
    const next = await appointment(clinic);
    expect((await reserve(clinic, next.appointmentId)).status).toBe("reserved");

    const { data: old } = await service()
      .from("video_call_reservations")
      .select("status, release_reason")
      .eq("id", reservation.reservation_id)
      .single();
    expect(old).toEqual({ status: "released", release_reason: "inicio_incompleto" });
  });

  it("una cita presencial no reserva", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const appt = await appointment(clinic, "in_person");
    expect(await reserve(clinic, appt.appointmentId)).toEqual({ status: "not_video" });
  });

  it("SEGURIDAD: una clínica no reserva sobre la cita de otra", async () => {
    const owner = await paidClinic();
    const other = await paidClinic();
    await giveCredits(other.clinicId, 1);
    const appt = await appointment(owner);

    const { error } = await other.client.rpc("reserve_video_call", { p_appointment_id: appt.appointmentId });
    expect(error).not.toBeNull();
  });
});

d("descuento y liberación", () => {
  it("se descuenta una sola vez por consulta, aunque el paciente se reconecte", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const call = await startedVideoCall(clinic);

    expect(await consume(call.consultationId)).toBe("consumed");
    expect(await consume(call.consultationId)).toBe("already_consumed");

    expect(await reservationStatus(clinic, call.consultationId)).toBe("consumed");
    expect(await credits(clinic.client)).toEqual({ balance: 0, held: 0, available: 0 });
    const consumption = (await ledger(clinic.clinicId)).filter((m) => m.reason === "consumption");
    expect(consumption).toEqual([
      expect.objectContaining({ delta: -1, consultation_id: call.consultationId }),
    ]);
  });

  it("una consulta sin reserva no descuenta (plan que incluye video)", async () => {
    const clinic = await paidClinic("enterprise");
    const appt = await appointment(clinic);
    const consultationId = await startConsultation(clinic, appt);
    expect(await consume(consultationId)).toBe("no_reservation");
    expect(await ledger(clinic.clinicId)).toHaveLength(0);
  });

  it("SEGURIDAD: con la consulta en curso la reserva no se puede liberar", async () => {
    // Si se pudiera, bastaría liberar antes de que el paciente se conecte para no pagar.
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const call = await startedVideoCall(clinic);

    expect(await release(clinic, call.consultationId)).toBe(false);
    expect(await reservationStatus(clinic, call.consultationId)).toBe("held");
  });

  it("al cerrar sin que el paciente se conecte, la reserva se libera y el saldo vuelve", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const call = await startedVideoCall(clinic);
    await endConsultation(clinic, call.consultationId);

    expect(await release(clinic, call.consultationId)).toBe(true);
    expect(await reservationStatus(clinic, call.consultationId)).toBe("released");
    expect(await credits(clinic.client)).toEqual({ balance: 1, held: 0, available: 1 });
  });

  it("un aviso que llega tarde, de una conexión durante la consulta, sí descuenta", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const call = await startedVideoCall(clinic);
    const joinedAt = new Date(Date.now() - 60_000).toISOString();
    await endConsultation(clinic, call.consultationId);
    await release(clinic, call.consultationId);

    expect(await consume(call.consultationId, joinedAt)).toBe("consumed");
    expect((await credits(clinic.client)).balance).toBe(0);
  });

  it("una conexión posterior a la liberación no descuenta y queda constancia", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const call = await startedVideoCall(clinic);
    await endConsultation(clinic, call.consultationId);
    await release(clinic, call.consultationId);

    const later = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(await consume(call.consultationId, later)).toBe("released");
    expect((await credits(clinic.client)).balance).toBe(1);
    expect(await auditCount(clinic.clinicId, "video.join_after_release")).toBe(1);
  });
});

d("seguridad del saldo", () => {
  it("la sesión de la clínica no puede descontar, otorgar ni tocar el saldo", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const call = await startedVideoCall(clinic);
    const checkoutId = await packCheckout(clinic.clinicId, 10);

    const consumed = await clinic.client.rpc("consume_video_call", {
      p_consultation_id: call.consultationId,
      p_source: "sesion",
    });
    expect(consumed.error).not.toBeNull();

    const granted = await clinic.client.rpc("grant_video_pack", {
      p_clinic: clinic.clinicId,
      p_transaction_id: txId(),
      p_checkout_id: checkoutId,
      p_amount: 10 * VIDEO_CALL_PRICE_IN_CENTS,
    });
    expect(granted.error).not.toBeNull();

    const inserted = await clinic.client.from("video_credit_ledger").insert({
      clinic_id: clinic.clinicId,
      delta: 100,
      reason: "adjustment",
      note: "me regalo saldo",
    });
    expect(inserted.error).not.toBeNull();

    expect((await clinic.client.from("video_credit_ledger").select("id")).error).not.toBeNull();
    expect((await clinic.client.from("video_call_reservations").select("id")).error).not.toBeNull();

    expect(await credits(clinic.client)).toEqual({ balance: 1, held: 1, available: 0 });
  });

  it("el saldo de una clínica no se ve desde otra", async () => {
    const withCredits = await paidClinic();
    await giveCredits(withCredits.clinicId, 10);
    const other = await paidClinic();
    expect(await credits(other.client)).toEqual({ balance: 0, held: 0, available: 0 });
  });

  it("los ajustes y el saldo de la consola exigen admin de plataforma", async () => {
    const clinic = await paidClinic();
    const adjusted = await clinic.client.rpc("platform_adjust_video_credits", {
      target_clinic: clinic.clinicId,
      p_delta: 10,
      p_note: "cortesía no autorizada",
    });
    expect(adjusted.error).not.toBeNull();

    const listed = await clinic.client.rpc("get_platform_video_credits", {
      p_clinic_ids: [clinic.clinicId],
    });
    expect(listed.error).not.toBeNull();
    expect(await ledger(clinic.clinicId)).toHaveLength(0);
  });

  it("un movimiento del saldo no se puede modificar: se compensa con otro", async () => {
    const clinic = await paidClinic();
    await giveCredits(clinic.clinicId, 1);
    const [movement] = await ledger(clinic.clinicId);

    const { error } = await service()
      .from("video_credit_ledger")
      .update({ delta: 10 })
      .eq("id", movement.id);
    expect(error).not.toBeNull();
    expect((await credits(clinic.client)).balance).toBe(1);
  });
});
