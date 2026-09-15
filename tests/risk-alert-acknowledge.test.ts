import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import type { SessionUser } from "@/lib/auth";
import { acknowledgeRiskAlert } from "@/lib/db/risk-alerts";
import { acknowledgeRiskAlertAction } from "@/app/(app)/dashboard/actions";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Estas pruebas escriben con service-role.
import "./helpers/supabase-env";

/**
 * El acuse de recibo de una alerta de riesgo deja una auditoría legal. Con RLS,
 * un UPDATE que la política `risk_alerts_update` no deja pasar no devuelve
 * error sino 0 filas: estas pruebas fijan que ese caso no se registre como un
 * acuse, y que un segundo acuse no borre quién atendió la alerta primero.
 */

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = URL && ANON && SERVICE ? describe : describe.skip;

// El código bajo prueba usa el cliente de sesión de Next (cookies) y
// `requireUser`. Aquí se reemplazan por un cliente supabase-js con la sesión
// del usuario de la prueba: RLS se aplica igual, con su JWT.
const session = vi.hoisted(() => ({
  client: null as unknown,
  user: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => session.user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

interface Staff {
  client: SupabaseClient;
  user: SessionUser;
}

function anon(): SupabaseClient {
  return createClient(URL!, ANON!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function service(): SupabaseClient {
  return createClient(URL!, SERVICE!, { auth: { autoRefreshToken: false, persistSession: false } });
}

function as(staff: Staff) {
  session.client = staff.client;
  session.user = staff.user;
}

async function signUp() {
  const client = anon();
  const email = `ack_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@e-irene.test`;
  const { data, error } = await client.auth.signUp({ email, password: "Password123!" });
  expect(error).toBeNull();
  return { client, userId: data.user!.id, email };
}

function sessionUser(id: string, email: string, role: SessionUser["role"], clinicId: string): SessionUser {
  return {
    id,
    email,
    fullName: "Profesional Demo",
    role,
    clinicId,
    clinicName: "Clínica Demo",
    clinicSuspended: false,
    verificationStatus: "verified",
  };
}

/** Clínica nueva con su admin (vía el RPC de onboarding, igual que rls.test.ts). */
async function bootstrapClinic(name: string): Promise<Staff> {
  const { client, userId, email } = await signUp();
  const { data: clinicId, error } = await client.rpc("create_clinic_and_admin", {
    clinic_name: name,
    full_name: "Admin Demo",
  });
  expect(error).toBeNull();
  return { client, user: sessionUser(userId, email, "admin", clinicId as string) };
}

/** Miembro de la clínica: el perfil lo crea el servidor (service-role), como addMember. */
async function addMember(clinic: Staff, role: "doctor" | "secretaria"): Promise<Staff> {
  const { client, userId, email } = await signUp();
  const { error } = await service().from("users").insert({
    id: userId,
    clinic_id: clinic.user.clinicId,
    role,
    full_name: `${role} demo`,
    email,
  });
  expect(error).toBeNull();
  return { client, user: sessionUser(userId, email, role, clinic.user.clinicId) };
}

/** Alerta abierta (sin acuse) en la clínica, con paciente y consulta sintéticos. */
async function openAlert(clinic: Staff): Promise<string> {
  const s = service();
  const clinicId = clinic.user.clinicId;
  const { data: patient, error: patientErr } = await s
    .from("patients")
    .insert({ clinic_id: clinicId, full_name_enc: encrypt("Paciente Demo") })
    .select("id")
    .single();
  expect(patientErr).toBeNull();
  const { data: consultation, error: consultErr } = await s
    .from("consultations")
    .insert({ clinic_id: clinicId, patient_id: patient!.id, doctor_id: clinic.user.id })
    .select("id")
    .single();
  expect(consultErr).toBeNull();
  const { data: alert, error: alertErr } = await s
    .from("risk_alerts")
    .insert({
      clinic_id: clinicId,
      source: "session_analysis",
      consultation_id: consultation!.id,
      patient_id: patient!.id,
      doctor_id: clinic.user.id,
      categories_enc: encrypt(JSON.stringify([{ key: "self_harm", level: "alto", evidence: "Texto de prueba." }])),
    })
    .select("id")
    .single();
  expect(alertErr).toBeNull();
  return alert!.id as string;
}

async function alertRow(alertId: string) {
  const { data, error } = await service()
    .from("risk_alerts")
    .select("acknowledged_at, acknowledged_by")
    .eq("id", alertId)
    .single();
  expect(error).toBeNull();
  return data!;
}

/** Auditorías de acuse para la alerta, en cualquier clínica. */
async function acknowledgeAudits(alertId: string) {
  const { data, error } = await service()
    .from("audit_logs")
    .select("actor_id")
    .eq("action", "risk_alert.acknowledged")
    .eq("entity_id", alertId);
  expect(error).toBeNull();
  return data ?? [];
}

d("acuse de recibo de alertas de riesgo", () => {
  let A: Staff;
  let doctorA: Staff;
  let secretariaA: Staff;
  let B: Staff;

  beforeAll(async () => {
    A = await bootstrapClinic("Clínica Alertas A");
    B = await bootstrapClinic("Clínica Alertas B");
    doctorA = await addMember(A, "doctor");
    secretariaA = await addMember(A, "secretaria");
  }, 30000);

  // ── Lo que no debe quedar registrado como acuse ───────────────────────────

  it("otra clínica NO puede acusar la alerta y no queda auditoría", async () => {
    const alertId = await openAlert(A);
    as(B);

    expect(await acknowledgeRiskAlert(alertId, B.user.id)).toBe("not_allowed");

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await expect(acknowledgeRiskAlertAction(alertId)).rejects.toThrow();
    expect(warn).toHaveBeenCalledWith("risk_alert.acknowledge_denied", expect.objectContaining({ alertId }));
    warn.mockRestore();

    expect(await alertRow(alertId)).toEqual({ acknowledged_at: null, acknowledged_by: null });
    expect(await acknowledgeAudits(alertId)).toHaveLength(0);
  });

  it("una secretaría NO puede acusar una alerta de su propia clínica", async () => {
    const alertId = await openAlert(A);
    as(secretariaA);

    // La secretaría sí puede LEER la alerta (la política de select es por
    // clínica): la relectura no puede confundir eso con "ya estaba acusada".
    expect(await acknowledgeRiskAlert(alertId, secretariaA.user.id)).toBe("not_allowed");

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await expect(acknowledgeRiskAlertAction(alertId)).rejects.toThrow();
    warn.mockRestore();

    expect(await alertRow(alertId)).toEqual({ acknowledged_at: null, acknowledged_by: null });
    expect(await acknowledgeAudits(alertId)).toHaveLength(0);
  });

  it("una alerta inexistente no se da por acusada", async () => {
    const alertId = randomUUID();
    as(doctorA);

    expect(await acknowledgeRiskAlert(alertId, doctorA.user.id)).toBe("not_allowed");

    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await expect(acknowledgeRiskAlertAction(alertId)).rejects.toThrow();
    warn.mockRestore();

    expect(await acknowledgeAudits(alertId)).toHaveLength(0);
  });

  // ── El acuse legítimo ─────────────────────────────────────────────────────

  it("el doctor de la clínica acusa recibo y queda una auditoría a su nombre", async () => {
    const alertId = await openAlert(A);
    as(doctorA);

    await acknowledgeRiskAlertAction(alertId);

    const row = await alertRow(alertId);
    expect(row.acknowledged_by).toBe(doctorA.user.id);
    expect(row.acknowledged_at).not.toBeNull();
    expect(await acknowledgeAudits(alertId)).toEqual([{ actor_id: doctorA.user.id }]);
  });

  // ── Un segundo acuse ──────────────────────────────────────────────────────

  it("un segundo acuse NO pisa quién atendió la alerta primero ni se audita", async () => {
    const alertId = await openAlert(A);
    as(doctorA);
    await acknowledgeRiskAlertAction(alertId);
    const first = await alertRow(alertId);

    // El admin llega después: no es una denegación, pero tampoco es su acuse.
    as(A);
    expect(await acknowledgeRiskAlert(alertId, A.user.id)).toBe("already_acknowledged");
    await expect(acknowledgeRiskAlertAction(alertId)).resolves.toBeUndefined();

    expect(await alertRow(alertId)).toEqual(first);
    expect(await acknowledgeAudits(alertId)).toEqual([{ actor_id: doctorA.user.id }]);
  });

  it("un doble clic acusa una sola vez y deja una sola auditoría", async () => {
    const alertId = await openAlert(A);
    as(doctorA);

    await Promise.all([acknowledgeRiskAlertAction(alertId), acknowledgeRiskAlertAction(alertId)]);

    expect((await alertRow(alertId)).acknowledged_by).toBe(doctorA.user.id);
    expect(await acknowledgeAudits(alertId)).toEqual([{ actor_id: doctorA.user.id }]);
  });
});
