import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import type { Plan } from "@/lib/plans";
import type { BillingStatus } from "@/lib/db/billing";
import { billingCycleBounds } from "@/lib/dates";

export interface DoctorOption {
  id: string;
  fullName: string;
}

export interface ClinicSubscription {
  status: BillingStatus;
  /** Hasta cuándo cubre lo pagado; null sin suscripción paga. */
  currentPeriodEnd: string | null;
  /** Cancelación pedida: conserva el plan hasta currentPeriodEnd y no se renueva. */
  cancelAtPeriodEnd: boolean;
}

export interface ClinicOverview {
  plan: Plan;
  patientCount: number;
  doctorCount: number;
  memberCount: number;
  /** Consultas iniciadas en el ciclo vigente: el límite del plan se aplica por ciclo. */
  consultationsThisCycle: number;
  /** Ciclo vigente [cycleStart, cycleEnd). Las cuotas se reinician en cycleEnd. */
  cycleStart: string;
  cycleEnd: string;
  subscription: ClinicSubscription;
}

/**
 * Plan, ciclo, suscripción y conteos de la clínica del usuario (RLS scoped).
 *
 * La fila de la clínica va primero porque su ancla define desde cuándo se
 * cuentan las consultas. Se filtra por id en vez de confiar en que RLS deje una
 * sola fila: para un platform admin, clinic_select las devuelve todas (ver
 * lib/db/transcription-usage.ts).
 */
export async function getClinicOverview(): Promise<ClinicOverview> {
  const user = await getSessionUser();
  if (!user) throw new Error("getClinicOverview requiere una sesión");
  const supabase = await createClient();

  const { data: clinic, error } = await supabase
    .from("clinics")
    .select("plan, billing_cycle_anchor, billing_status, current_period_end, cancel_at_period_end")
    .eq("id", user.clinicId)
    .single();
  if (error) throw error;

  const cycle = billingCycleBounds(clinic.billing_cycle_anchor);
  const [patients, doctors, members, consultations] = await Promise.all([
    supabase.from("patients").select("*", { count: "exact", head: true }),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .in("role", ["admin", "doctor"]),
    supabase.from("users").select("*", { count: "exact", head: true }),
    supabase
      .from("consultations")
      .select("*", { count: "exact", head: true })
      .gte("started_at", cycle.start.toISOString()),
  ]);
  return {
    plan: clinic.plan as Plan,
    patientCount: patients.count ?? 0,
    doctorCount: doctors.count ?? 0,
    memberCount: members.count ?? 0,
    consultationsThisCycle: consultations.count ?? 0,
    cycleStart: cycle.start.toISOString(),
    cycleEnd: cycle.end.toISOString(),
    subscription: {
      status: clinic.billing_status as BillingStatus,
      currentPeriodEnd: clinic.current_period_end,
      cancelAtPeriodEnd: clinic.cancel_at_period_end,
    },
  };
}

/**
 * Plan y suscripción de la clínica del usuario, sin los conteos de
 * getClinicOverview: para los avisos que se muestran en cada entrada.
 */
export async function getClinicSubscription(): Promise<{
  plan: Plan;
  subscription: ClinicSubscription;
}> {
  const user = await getSessionUser();
  if (!user) throw new Error("getClinicSubscription requiere una sesión");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinics")
    .select("plan, billing_status, current_period_end, cancel_at_period_end")
    .eq("id", user.clinicId)
    .single();
  if (error) throw error;
  return {
    plan: data.plan as Plan,
    subscription: {
      status: data.billing_status as BillingStatus,
      currentPeriodEnd: data.current_period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
    },
  };
}

/** Profesionales de la clínica (admin/doctor) para selectores. RLS scoped. */
export async function listDoctors(): Promise<DoctorOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name")
    .in("role", ["admin", "doctor"])
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, fullName: u.full_name }));
}

export interface DoctorContact {
  id: string;
  fullName: string;
  email: string;
}

/**
 * Como `listDoctors`, pero para el flujo de link público sin sesión: usa el
 * cliente service-role y recibe `clinicId` explícito (no hay `auth_clinic_id()`
 * disponible sin JWT de usuario). Incluye `email` porque se usa para enviar
 * alertas, a diferencia de `listDoctors` (solo para selectores en la UI).
 */
export async function listDoctorsPublic(clinicId: string): Promise<DoctorContact[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("id, full_name, email")
    .eq("clinic_id", clinicId)
    .in("role", ["admin", "doctor"])
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, fullName: u.full_name, email: u.email }));
}
