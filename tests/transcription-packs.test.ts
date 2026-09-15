import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { billingCycleBounds } from "@/lib/dates";
import { TRANSCRIPTION_PACK, transcriptionLimitSeconds } from "@/lib/plans";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";
import { LOCK_WAIT_MS, lockAcrossRuns, SUBSCRIPTION_SWEEPS_LOCK } from "./helpers/db-lock";

/**
 * Bolsa de transcripción (migración 0057), contra Supabase local.
 *
 * Lo que protegen, en términos de negocio:
 *  · un pago aprobado otorga 5 h una sola vez, que vencen con el ciclo;
 *  · un pago que no corresponde (monto, checkout ajeno, plan sin bolsa, sin
 *    período) no otorga nada y queda para reembolso;
 *  · la cuota suma solo las bolsas vigentes de la propia clínica, y la sesión de la
 *    clínica no puede otorgarse horas ni leer o escribir las bolsas.
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

const DAY = 24 * 60 * 60 * 1000;
const PACK_SECONDS = TRANSCRIPTION_PACK.hours * 3600;
const ESENCIAL_LIMIT = transcriptionLimitSeconds("esencial")!;

type Clinic = { client: SupabaseClient; clinicId: string };

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

const iso = (value: string | Date | null) => (value === null ? null : new Date(value).toISOString());
const txId = () => `tx-demo-${randomUUID()}`;

/** Ahora truncado al segundo, como lo guarda la base. */
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
    clinic_name: "Clínica Demo Bolsa",
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  // Sin verificar al profesional, crear pacientes y consultas falla por RLS (0032).
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

/** Clínica Esencial con un período vigente anclado hace 10 días. */
async function paidClinic(patch: Record<string, unknown> = {}) {
  const clinic = await bootstrapClinic();
  const anchor = nowSeconds(-10 * DAY).toISOString();
  const periodEnd = billingCycleBounds(anchor, new Date()).end.toISOString();
  await setClinic(clinic.clinicId, {
    plan: "esencial",
    billing_status: "activo",
    billing_cycle_anchor: anchor,
    current_period_end: periodEnd,
    ...patch,
  });
  return { ...clinic, anchor, periodEnd };
}

async function packCheckout(
  clinicId: string,
  overrides: { kind?: string; quantity?: number; amountInCents?: number } = {},
): Promise<string> {
  const { data, error } = await service()
    .from("billing_checkouts")
    .insert({
      wompi_payment_link_id: `test_${randomUUID()}`,
      clinic_id: clinicId,
      plan: "esencial",
      amount_in_cents: overrides.amountInCents ?? TRANSCRIPTION_PACK.priceInCents,
      reference: `transcriptionpack-${clinicId}-${Date.now()}`,
      kind: overrides.kind ?? "transcription_pack",
      quantity: overrides.quantity ?? 1,
      details: { hours: TRANSCRIPTION_PACK.hours },
      expires_at: new Date(Date.now() + DAY).toISOString(),
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function grant(clinicId: string, checkoutId: string, amount: number, tx = txId()) {
  const { data, error } = await service().rpc("grant_transcription_pack", {
    p_clinic: clinicId,
    p_transaction_id: tx,
    p_checkout_id: checkoutId,
    p_amount: amount,
  });
  expect(error).toBeNull();
  return data as {
    outcome: string;
    reason?: string;
    seconds?: number;
    valid_until?: string;
    already_processed: boolean;
  };
}

async function packs(clinicId: string) {
  const { data, error } = await service()
    .from("transcription_packs")
    .select("seconds, valid_from, valid_until, source, wompi_transaction_id")
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

async function usage(client: SupabaseClient) {
  const { data, error } = await client.rpc("get_transcription_usage");
  expect(error).toBeNull();
  return data as {
    used_seconds: number;
    sessions: number;
    extra_seconds: number;
    extra_valid_until: string | null;
  };
}

/** Consumo ya cerrado en el ciclo vigente, sin pasar por una consulta real. */
async function consume(clinicId: string, seconds: number) {
  const { error } = await service().from("transcription_usage").insert({
    clinic_id: clinicId,
    consultation_id: randomUUID(),
    started_at: new Date(Date.now() - 60_000).toISOString(),
    seconds,
    finalized_at: new Date().toISOString(),
  });
  expect(error).toBeNull();
}

async function createConsultation({ client, clinicId }: Clinic): Promise<string> {
  const { data: auth } = await client.auth.getUser();
  const { data: patient, error: pErr } = await client
    .from("patients")
    .insert({ clinic_id: clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  expect(pErr).toBeNull();
  const { data: consult, error: cErr } = await client
    .from("consultations")
    .insert({ clinic_id: clinicId, patient_id: patient!.id, doctor_id: auth.user!.id })
    .select("id")
    .single();
  expect(cErr).toBeNull();
  return consult!.id as string;
}

async function begin(clinic: Clinic, limit: number | null) {
  const consultationId = await createConsultation(clinic);
  const { data, error } = await clinic.client.rpc("begin_transcription_session", {
    p_consultation_id: consultationId,
    p_limit_seconds: limit,
  });
  expect(error).toBeNull();
  return data as { allowed: boolean; used_seconds: number; extra_seconds: number };
}

d("compra de la bolsa (grant_transcription_pack)", () => {
  it("otorga las horas hasta el fin del ciclo, una sola vez por transacción", async () => {
    const clinic = await paidClinic();
    const checkoutId = await packCheckout(clinic.clinicId);
    const tx = txId();

    const first = await grant(clinic.clinicId, checkoutId, TRANSCRIPTION_PACK.priceInCents, tx);
    expect(first).toMatchObject({ outcome: "applied", seconds: PACK_SECONDS, already_processed: false });
    // Vence cuando se reinicia la cuota: el fin del ciclo vigente.
    expect(iso(first.valid_until!)).toBe(clinic.periodEnd);

    // El webhook y la reconciliación al volver del checkout llegan los dos.
    const retry = await grant(clinic.clinicId, checkoutId, TRANSCRIPTION_PACK.priceInCents, tx);
    expect(retry).toMatchObject({ outcome: "applied", already_processed: true });

    expect(await packs(clinic.clinicId)).toHaveLength(1);
    expect(await auditCount(clinic.clinicId, "billing.transcription_pack_granted")).toBe(1);

    const u = await usage(clinic.client);
    expect(Number(u.extra_seconds)).toBe(PACK_SECONDS);
    expect(iso(u.extra_valid_until)).toBe(clinic.periodEnd);
  });

  it("las horas que otorga la base son las que se venden en lib/plans.ts", async () => {
    const { data, error } = await service().rpc("transcription_pack_seconds");
    expect(error).toBeNull();
    expect(data).toBe(PACK_SECONDS);
  });

  it("se pueden comprar varias en el mismo ciclo", async () => {
    const clinic = await paidClinic();
    for (let i = 0; i < 2; i++) {
      const checkoutId = await packCheckout(clinic.clinicId);
      const result = await grant(clinic.clinicId, checkoutId, TRANSCRIPTION_PACK.priceInCents);
      expect(result.outcome).toBe("applied");
    }
    expect(Number((await usage(clinic.client)).extra_seconds)).toBe(2 * PACK_SECONDS);
  });

  const rejections: [
    reason: string,
    arrange: () => Promise<{ clinicId: string; checkoutId: string; amount: number }>,
  ][] = [
    [
      "monto_no_coincide_con_la_compra",
      async () => {
        const { clinicId } = await paidClinic();
        const checkoutId = await packCheckout(clinicId);
        return { clinicId, checkoutId, amount: 100 };
      },
    ],
    [
      "checkout_no_corresponde",
      async () => {
        // El checkout de otra clínica no otorga horas en esta.
        const mine = await paidClinic();
        const other = await paidClinic();
        const checkoutId = await packCheckout(other.clinicId);
        return { clinicId: mine.clinicId, checkoutId, amount: TRANSCRIPTION_PACK.priceInCents };
      },
    ],
    [
      "checkout_no_corresponde",
      async () => {
        // Un checkout de plan con el mismo monto no es una bolsa.
        const { clinicId } = await paidClinic();
        const checkoutId = await packCheckout(clinicId, { kind: "plan" });
        return { clinicId, checkoutId, amount: TRANSCRIPTION_PACK.priceInCents };
      },
    ],
    [
      "cantidad_invalida",
      async () => {
        const { clinicId } = await paidClinic();
        const checkoutId = await packCheckout(clinicId, { quantity: 2 });
        return { clinicId, checkoutId, amount: TRANSCRIPTION_PACK.priceInCents };
      },
    ],
    [
      "el_plan_no_admite_bolsa",
      async () => {
        // Pagó con plan pago, pero la suscripción terminó antes de aprobarse el pago.
        const { clinicId } = await bootstrapClinic();
        const checkoutId = await packCheckout(clinicId);
        return { clinicId, checkoutId, amount: TRANSCRIPTION_PACK.priceInCents };
      },
    ],
    [
      "sin_periodo_vigente",
      async () => {
        const anchor = nowSeconds(-45 * DAY).toISOString();
        const periodEnd = billingCycleBounds(anchor, new Date(Date.now() - 40 * DAY)).end;
        expect(periodEnd.getTime()).toBeLessThan(Date.now());
        const { clinicId } = await paidClinic({
          billing_cycle_anchor: anchor,
          current_period_end: periodEnd.toISOString(),
          billing_status: "vencido",
        });
        const checkoutId = await packCheckout(clinicId);
        return { clinicId, checkoutId, amount: TRANSCRIPTION_PACK.priceInCents };
      },
    ],
  ];

  it.each(rejections)("no otorga horas y deja para reembolso: %s", async (reason, arrange) => {
    const { clinicId, checkoutId, amount } = await arrange();
    const tx = txId();

    const result = await grant(clinicId, checkoutId, amount, tx);
    expect(result).toMatchObject({ outcome: "rejected", reason });

    expect(await packs(clinicId)).toHaveLength(0);
    const { data: fulfillment } = await service()
      .from("billing_fulfillments")
      .select("kind, outcome, reason")
      .eq("wompi_transaction_id", tx)
      .single();
    expect(fulfillment).toEqual({ kind: "transcription_pack", outcome: "rejected", reason });
    expect(await auditCount(clinicId, "billing.payment_rejected")).toBe(1);
  });

  it("SEGURIDAD: la sesión de la clínica no puede otorgarse horas ni tocar las bolsas", async () => {
    const clinic = await paidClinic();
    const checkoutId = await packCheckout(clinic.clinicId);

    const granted = await clinic.client.rpc("grant_transcription_pack", {
      p_clinic: clinic.clinicId,
      p_transaction_id: txId(),
      p_checkout_id: checkoutId,
      p_amount: TRANSCRIPTION_PACK.priceInCents,
    });
    expect(granted.error).not.toBeNull();

    const inserted = await clinic.client.from("transcription_packs").insert({
      clinic_id: clinic.clinicId,
      seconds: 360_000,
      valid_until: new Date(Date.now() + DAY).toISOString(),
      source: "grant",
    });
    expect(inserted.error).not.toBeNull();

    const selected = await clinic.client.from("transcription_packs").select("id");
    expect(selected.error).not.toBeNull();

    const extra = await clinic.client.rpc("transcription_extra_seconds", {
      p_clinic: clinic.clinicId,
    });
    expect(extra.error).not.toBeNull();

    expect(await packs(clinic.clinicId)).toHaveLength(0);
  });
});

d("la cuota suma las bolsas vigentes (begin_transcription_session)", () => {
  it("con la cuota del plan agotada, una bolsa vigente permite transcribir otra vez", async () => {
    const clinic = await paidClinic();
    await consume(clinic.clinicId, ESENCIAL_LIMIT);

    const denied = await begin(clinic, ESENCIAL_LIMIT);
    expect(denied.allowed).toBe(false);
    expect(Number(denied.extra_seconds)).toBe(0);

    const checkoutId = await packCheckout(clinic.clinicId);
    await grant(clinic.clinicId, checkoutId, TRANSCRIPTION_PACK.priceInCents);

    const allowed = await begin(clinic, ESENCIAL_LIMIT);
    expect(allowed.allowed).toBe(true);
    expect(Number(allowed.extra_seconds)).toBe(PACK_SECONDS);

    // Consumida también la bolsa, vuelve a negar.
    await consume(clinic.clinicId, PACK_SECONDS);
    expect((await begin(clinic, ESENCIAL_LIMIT)).allowed).toBe(false);
  });

  it("una bolsa vencida o que todavía no rige no suma", async () => {
    const clinic = await paidClinic();
    await consume(clinic.clinicId, ESENCIAL_LIMIT);
    const { error } = await service()
      .from("transcription_packs")
      .insert([
        {
          clinic_id: clinic.clinicId,
          seconds: PACK_SECONDS,
          valid_from: new Date(Date.now() - 40 * DAY).toISOString(),
          valid_until: new Date(Date.now() - 1000).toISOString(),
          source: "grant",
        },
        {
          clinic_id: clinic.clinicId,
          seconds: PACK_SECONDS,
          valid_from: new Date(Date.now() + DAY).toISOString(),
          valid_until: new Date(Date.now() + 10 * DAY).toISOString(),
          source: "grant",
        },
      ]);
    expect(error).toBeNull();

    const res = await begin(clinic, ESENCIAL_LIMIT);
    expect(res.allowed).toBe(false);
    expect(Number(res.extra_seconds)).toBe(0);
    const u = await usage(clinic.client);
    expect(Number(u.extra_seconds)).toBe(0);
    expect(u.extra_valid_until).toBeNull();
  });

  it("las bolsas de otra clínica no cuentan en esta", async () => {
    const withPack = await paidClinic();
    const checkoutId = await packCheckout(withPack.clinicId);
    await grant(withPack.clinicId, checkoutId, TRANSCRIPTION_PACK.priceInCents);

    const other = await paidClinic();
    await consume(other.clinicId, ESENCIAL_LIMIT);
    const res = await begin(other, ESENCIAL_LIMIT);
    expect(res.allowed).toBe(false);
    expect(Number((await usage(other.client)).extra_seconds)).toBe(0);
  });

  it("un plan ilimitado sigue sin tope", async () => {
    const clinic = await paidClinic();
    await consume(clinic.clinicId, ESENCIAL_LIMIT * 10);
    expect((await begin(clinic, null)).allowed).toBe(true);
  });
});
