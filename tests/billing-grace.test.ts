import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { BILLING_GRACE_DAYS } from "@/lib/billing/subscription-state";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";
import { LOCK_WAIT_MS, lockAcrossRuns, SUBSCRIPTION_SWEEPS_LOCK } from "./helpers/db-lock";

/**
 * Gracia por impago (migración 0042), contra Supabase local.
 *
 * Lo que protegen: una suscripción que no se paga termina en Free 5 días después
 * del fin del período pagado —ni antes, ni nunca—, sin cortar a quien tiene un
 * pago en curso o ya pagó, y sin tocar cancelaciones ni planes asignados.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

// El barrido que se ejerce aquí es GLOBAL, igual que end_canceled_subscriptions
// en billing-cycle.test.ts, y cada archivo siembra clínicas que alcanza el barrido
// del otro. Vitest los corre en paralelo, así que se turnan: ver
// SUBSCRIPTION_SWEEPS_LOCK en helpers/db-lock.ts. Se suelta después de la
// limpieza de abajo, con las clínicas de este archivo ya fuera de su alcance.
let unlock: (() => Promise<void>) | undefined;
beforeAll(async () => {
  if (URL && ANON && SERVICE) unlock = await lockAcrossRuns(SUBSCRIPTION_SWEEPS_LOCK);
}, LOCK_WAIT_MS + 10_000);
afterAll(async () => {
  await unlock?.();
});

const DAY = 24 * 60 * 60 * 1000;

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Hace `days` días, truncado al segundo como lo guarda la base. */
function daysAgo(days: number): string {
  return new Date(Math.floor((Date.now() - days * DAY) / 1000) * 1000).toISOString();
}

/** Clínicas que crea este archivo, para sacarlas del cobro al terminar. */
const createdClinicIds: string[] = [];

async function bootstrapClinic(name: string) {
  const client = anon();
  const email = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { error: signErr } = await client.auth.signUp({ email, password: "Password123!" });
  expect(signErr).toBeNull();
  const { data: clinicId, error: rpcErr } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Doctor Test",
  });
  expect(rpcErr).toBeNull();
  createdClinicIds.push(clinicId as string);
  return { client, clinicId: clinicId as string };
}

/** Clínica con plan pago activado por un pago y luego llevada al estado `patch`. */
async function paidClinic(name: string, patch: Record<string, unknown>) {
  const clinic = await bootstrapClinic(name);
  const { error } = await service().rpc("activate_subscription", {
    p_clinic: clinic.clinicId,
    p_plan: "pro",
    p_payment_source_enc: encrypt("ps-demo"),
  });
  expect(error).toBeNull();
  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await service().from("clinics").update(patch).eq("id", clinic.clinicId);
    expect(updErr).toBeNull();
  }
  return clinic;
}

async function clinicRow(clinicId: string) {
  const { data, error } = await service()
    .from("clinics")
    .select("plan, billing_status, current_period_end, cancel_at_period_end, wompi_payment_source_id_enc")
    .eq("id", clinicId)
    .single();
  expect(error).toBeNull();
  return data!;
}

async function auditMetadata(clinicId: string, action: string) {
  const { data, error } = await service()
    .from("audit_logs")
    .select("metadata")
    .eq("clinic_id", clinicId)
    .eq("action", action);
  expect(error).toBeNull();
  return (data ?? []).map((r) => r.metadata as Record<string, string>);
}

d("gracia por impago", () => {
  // La base local es compartida y no se reinicia entre corridas. Sin esto, las
  // clínicas que quedan con plan pago, período y token entran al cobro recurrente
  // de todas las corridas siguientes; y si la corrida usó otra ENCRYPTION_KEY,
  // su token ya no descifra con ninguna otra.
  afterAll(async () => {
    if (createdClinicIds.length === 0) return;
    const { error, count } = await service()
      .from("clinics")
      .update(
        {
          plan: "free",
          billing_status: "sin_configurar",
          current_period_end: null,
          cancel_at_period_end: false,
          cancel_requested_at: null,
          wompi_payment_source_id_enc: null,
        },
        { count: "exact" },
      )
      .in("id", createdClinicIds);
    expect(error).toBeNull();
    expect(count).toBe(createdClinicIds.length);
  }, 30000);

  it("billing_grace_period() coincide con el plazo que muestra la interfaz", async () => {
    const { data, error } = await service().rpc("billing_grace_period");
    expect(error).toBeNull();
    expect(data).toBe(`${BILLING_GRACE_DAYS} days`);
  });

  it("la sesión de la clínica no puede marcar impagos ni barrer suscripciones", async () => {
    const clinic = await bootstrapClinic("Clínica Gracia Permisos");
    const mark = await clinic.client.rpc("mark_subscription_payment_failed", {
      p_clinic: clinic.clinicId,
      p_reason: "inventado",
    });
    expect(mark.error).not.toBeNull();
    const sweep = await clinic.client.rpc("end_overdue_subscriptions");
    expect(sweep.error).not.toBeNull();
  }, 30000);

  it("el primer cobro fallido del período la marca vencida y deja constancia una sola vez", async () => {
    const clinic = await paidClinic("Clínica Gracia Fallo", {});

    const first = await service().rpc("mark_subscription_payment_failed", {
      p_clinic: clinic.clinicId,
      p_reason: "wompi_402: tarjeta rechazada",
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);

    // El cron reintenta a diario: los intentos siguientes no repiten la constancia.
    const second = await service().rpc("mark_subscription_payment_failed", {
      p_clinic: clinic.clinicId,
      p_reason: "wompi_402: tarjeta rechazada",
    });
    expect(second.data).toBe(false);

    expect((await clinicRow(clinic.clinicId)).billing_status).toBe("vencido");
    const audits = await auditMetadata(clinic.clinicId, "subscription.payment_failed");
    expect(audits).toHaveLength(1);
    const graceMs =
      new Date(audits[0].grace_ends_at).getTime() - new Date(audits[0].period_end).getTime();
    expect(graceMs).toBe(BILLING_GRACE_DAYS * DAY);
  }, 30000);

  describe("barrido de suscripciones vencidas", () => {
    let vencida: { clinicId: string };
    let enGracia: { clinicId: string };
    let cobroEnCurso: { clinicId: string };
    let cancelada: { clinicId: string };
    let asignada: { clinicId: string };
    let pagoEnGracia: { clinicId: string };

    beforeAll(async () => {
      vencida = await paidClinic("Clínica Gracia Vencida", {
        billing_status: "vencido",
        current_period_end: daysAgo(BILLING_GRACE_DAYS + 1),
      });
      enGracia = await paidClinic("Clínica En Gracia", {
        billing_status: "vencido",
        current_period_end: daysAgo(BILLING_GRACE_DAYS - 1),
      });

      cobroEnCurso = await paidClinic("Clínica Cobro En Curso", {
        billing_status: "vencido",
        current_period_end: daysAgo(BILLING_GRACE_DAYS + 1),
      });
      const due = (await clinicRow(cobroEnCurso.clinicId)).current_period_end as string;
      const { error: chargeErr } = await service().from("billing_scheduled_charges").insert({
        clinic_id: cobroEnCurso.clinicId,
        plan: "pro",
        amount_in_cents: 2_900_000,
        due_at: due,
        period_key: new Date(due).toISOString().slice(0, 10),
        status: "processing",
      });
      expect(chargeErr).toBeNull();

      cancelada = await paidClinic("Clínica Gracia Cancelada", {
        cancel_at_period_end: true,
        cancel_requested_at: daysAgo(10),
        current_period_end: daysAgo(BILLING_GRACE_DAYS + 1),
      });

      asignada = await bootstrapClinic("Clínica Plan Asignado");
      const { error: planErr } = await service()
        .from("clinics")
        .update({ plan: "clinica" })
        .eq("id", asignada.clinicId);
      expect(planErr).toBeNull();

      // Pagó desde la app durante la gracia: activate_subscription abre un período nuevo.
      pagoEnGracia = await paidClinic("Clínica Pagó En Gracia", {
        billing_status: "vencido",
        current_period_end: daysAgo(BILLING_GRACE_DAYS + 1),
      });
      const { error: payErr } = await service().rpc("activate_subscription", {
        p_clinic: pagoEnGracia.clinicId,
        p_plan: "pro",
        p_payment_source_enc: null,
      });
      expect(payErr).toBeNull();

      const { error } = await service().rpc("end_overdue_subscriptions");
      expect(error).toBeNull();
    }, 90000);

    it("pasada la gracia, la suscripción termina: Free, sin período ni token, con constancia", async () => {
      const row = await clinicRow(vencida.clinicId);
      expect(row.plan).toBe("free");
      expect(row.billing_status).toBe("sin_configurar");
      expect(row.current_period_end).toBeNull();
      expect(row.wompi_payment_source_id_enc).toBeNull();

      const ended = await auditMetadata(vencida.clinicId, "subscription.ended");
      expect(ended.map((m) => m.reason)).toContain("impago_tras_gracia");
    });

    it("dentro de la gracia conserva el plan", async () => {
      expect((await clinicRow(enGracia.clinicId)).plan).toBe("pro");
    });

    it("con un cobro todavía en curso no la termina: ese pago puede aprobarse", async () => {
      expect((await clinicRow(cobroEnCurso.clinicId)).plan).toBe("pro");
    });

    it("no toca las canceladas: terminan al fin del período, sin gracia, por su propio barrido", async () => {
      const row = await clinicRow(cancelada.clinicId);
      expect(row.plan).toBe("pro");
      expect(row.cancel_at_period_end).toBe(true);
    });

    it("no toca un plan asignado sin cobro", async () => {
      expect((await clinicRow(asignada.clinicId)).plan).toBe("clinica");
    });

    it("pagar durante la gracia la saca del impago", async () => {
      const row = await clinicRow(pagoEnGracia.clinicId);
      expect(row.plan).toBe("pro");
      expect(row.billing_status).toBe("activo");
    });
  });
});
