import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformClinicOverview } from "@/lib/db/platform-admin";
import type { UserRole } from "@/lib/auth";

// ============================ Doctores / personal ===========================

export interface AdminStaff {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
}

export async function listAllStaff(): Promise<AdminStaff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, clinic_id, clinics:clinics!users_clinic_id_fkey(name)")
    .neq("role", "paciente")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (
    data as unknown as {
      id: string;
      full_name: string;
      email: string;
      role: UserRole;
      clinic_id: string;
      clinics: { name: string } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    clinicId: r.clinic_id,
    clinicName: r.clinics?.name ?? "—",
  }));
}

export async function updateStaff(
  id: string,
  input: { fullName: string; role: UserRole },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ full_name: input.fullName, role: input.role })
    .eq("id", id);
  if (error) throw error;
}

/** Elimina la cuenta (auth + perfil por cascade). Falla si tiene registros
 *  dependientes (citas/consultas) — protección natural de la BD. */
export async function deleteStaff(id: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    const fk = /foreign key|violates|constraint/i.test(error.message);
    return {
      ok: false,
      error: fk
        ? "No se puede eliminar: el profesional tiene citas o consultas asociadas."
        : error.message,
    };
  }
  return { ok: true };
}

// ================================== Citas ===================================
//
// El super-admin gestiona la AGENDA (reagendar/cambiar estado/cancelar) como
// herramienta de soporte de negocio, pero NUNCA ve la identidad del paciente:
// la consulta no trae `full_name_enc` — solo profesional, clínica y horario.

export interface AdminAppointment {
  id: string;
  doctorName: string;
  clinicName: string;
  scheduledAt: string;
  durationMin: number;
  status: string;
  notes: string | null;
}

export async function listAllAppointments(): Promise<AdminAppointment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("appointments")
    .select(
      "id, scheduled_at, duration_min, status, notes, " +
        "doctor:users!appointments_doctor_id_fkey(full_name), " +
        "clinics:clinics!appointments_clinic_id_fkey(name)",
    )
    .order("scheduled_at", { ascending: false });
  if (error) throw error;
  return (
    data as unknown as {
      id: string;
      scheduled_at: string;
      duration_min: number;
      status: string;
      notes: string | null;
      doctor: { full_name: string } | null;
      clinics: { name: string } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    doctorName: r.doctor?.full_name ?? "—",
    clinicName: r.clinics?.name ?? "—",
    scheduledAt: r.scheduled_at,
    durationMin: r.duration_min,
    status: r.status,
    notes: r.notes,
  }));
}

type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";

export async function updateAppointmentAdmin(
  id: string,
  input: { scheduledAt?: string; status?: string },
): Promise<void> {
  const supabase = await createClient();
  const patch: { scheduled_at?: string; status?: AppointmentStatus } = {};
  if (input.scheduledAt) patch.scheduled_at = input.scheduledAt;
  if (input.status) patch.status = input.status as AppointmentStatus;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("appointments").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteAppointmentAdmin(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").delete().eq("id", id);
  if (error) throw error;
}

// ================================== Planes ==================================

export interface PlanConfig {
  plan: string;
  label: string;
  description: string;
  price: string;
  sortOrder: number;
}

export async function getPlanConfigs(): Promise<PlanConfig[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plan_configs")
    .select("plan, label, description, price, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (
    data as unknown as {
      plan: string;
      label: string;
      description: string;
      price: string;
      sort_order: number;
    }[]
  ).map((r) => ({
    plan: r.plan,
    label: r.label,
    description: r.description,
    price: r.price,
    sortOrder: r.sort_order,
  }));
}

export async function setPlanConfig(
  plan: string,
  input: { label: string; description: string; price: string },
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_plan_config", {
    p_plan: plan,
    p_label: input.label,
    p_description: input.description,
    p_price: input.price,
  });
  if (error) throw error;
}

// ============================= Mapa de clínicas =============================

export interface ClinicMapEntry {
  clinicId: string;
  clinicName: string;
  plan: string;
  suspended: boolean;
  doctors: { id: string; fullName: string; email: string; role: UserRole }[];
  patientCount: number;
}

/**
 * Clínicas con sus doctores y conteo de pacientes (el "mapa").
 *
 * El conteo de pacientes viene de get_platform_clinic_overview() (SECURITY
 * DEFINER, solo count, sin PII) — NO de leer filas de `patients`, a las que el
 * super-admin ya no tiene acceso vía RLS (ver migración 0015).
 */
export async function getClinicMap(): Promise<ClinicMapEntry[]> {
  const supabase = await createClient();
  const [{ data, error }, overview] = await Promise.all([
    supabase
      .from("clinics")
      .select(
        "id, name, plan, suspended_at, " +
          "users:users!users_clinic_id_fkey(id, full_name, email, role)",
      )
      .order("created_at", { ascending: false }),
    getPlatformClinicOverview(),
  ]);
  if (error) throw error;

  const patientCountByClinic = new Map(overview.map((o) => [o.clinicId, o.patientCount]));

  return (
    data as unknown as {
      id: string;
      name: string;
      plan: string;
      suspended_at: string | null;
      users: { id: string; full_name: string; email: string; role: UserRole }[];
    }[]
  ).map((c) => ({
    clinicId: c.id,
    clinicName: c.name,
    plan: c.plan,
    suspended: Boolean(c.suspended_at),
    doctors: (c.users ?? [])
      .filter((u) => u.role !== "paciente")
      .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, role: u.role })),
    patientCount: patientCountByClinic.get(c.id) ?? 0,
  }));
}
