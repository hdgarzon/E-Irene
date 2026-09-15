import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ADMIN_PAGE_SIZE,
  fetchListPage,
  ilikeCondition,
  type ListPage,
  type ListParams,
} from "@/lib/admin-list";
import type { UserRole } from "@/lib/auth";

// Las listas de este archivo se paginan en BD y cuentan con head: traerlas
// enteras las cortaba en max_rows (1000) sin aviso. Ver lib/admin-list.ts.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

// ============================ Doctores / personal ===========================

export interface AdminStaff {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
}

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  clinic_id: string;
  clinics: { name: string } | null;
}

/**
 * Personal (todo rol salvo paciente) de todas las clínicas, lo más reciente
 * primero, con búsqueda por nombre o correo.
 */
export async function listAllStaff(params: ListParams): Promise<ListPage<AdminStaff>> {
  const supabase = await createClient();
  const search = [
    ilikeCondition("full_name", params.query),
    ilikeCondition("email", params.query),
  ].join(",");
  const countStaff = () =>
    supabase.from("users").select("id", { count: "exact", head: true }).neq("role", "paciente");

  return fetchListPage({
    params,
    pageSize: ADMIN_PAGE_SIZE,
    countTotal: countStaff,
    countMatched: () => countStaff().or(search),
    fetchRows: (from, to) => {
      let query = supabase
        .from("users")
        .select("id, full_name, email, role, clinic_id, clinics:clinics!users_clinic_id_fkey(name)")
        .neq("role", "paciente");
      if (params.query) query = query.or(search);
      return query.order("created_at", { ascending: false }).order("id").range(from, to);
    },
    map: (r: StaffRow): AdminStaff => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      role: r.role,
      clinicId: r.clinic_id,
      clinicName: r.clinics?.name ?? "—",
    }),
  });
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
// la consulta no trae `full_name_enc` ni las notas de la cita (texto libre que
// puede describir al paciente) — solo profesional, clínica y horario.

export interface AdminAppointment {
  id: string;
  doctorName: string;
  clinicName: string;
  scheduledAt: string;
  durationMin: number;
  status: string;
}

interface AppointmentRow {
  id: string;
  scheduled_at: string;
  duration_min: number;
  status: string;
  doctor: { full_name: string } | null;
  clinics: { name: string } | null;
}

/** Con `!inner`, filtrar la clínica embebida acota las citas: así se busca por clínica. */
const APPOINTMENT_CLINIC = "clinics:clinics!appointments_clinic_id_fkey!inner(name)";

/** Citas de todas las clínicas, la fecha más lejana primero, con búsqueda por clínica. */
export async function listAllAppointments(params: ListParams): Promise<ListPage<AdminAppointment>> {
  const supabase = await createClient();
  const search = ilikeCondition("name", params.query);

  return fetchListPage({
    params,
    pageSize: ADMIN_PAGE_SIZE,
    countTotal: () => supabase.from("appointments").select("id", { count: "exact", head: true }),
    countMatched: () =>
      supabase
        .from("appointments")
        .select(`id, ${APPOINTMENT_CLINIC}`, { count: "exact", head: true })
        .or(search, { referencedTable: "clinics" }),
    fetchRows: (from, to) => {
      let query = supabase
        .from("appointments")
        .select(
          "id, scheduled_at, duration_min, status, " +
            "doctor:users!appointments_doctor_id_fkey(full_name), " +
            APPOINTMENT_CLINIC,
        );
      if (params.query) query = query.or(search, { referencedTable: "clinics" });
      return query.order("scheduled_at", { ascending: false }).order("id").range(from, to);
    },
    map: (r: AppointmentRow): AdminAppointment => ({
      id: r.id,
      doctorName: r.doctor?.full_name ?? "—",
      clinicName: r.clinics?.name ?? "—",
      scheduledAt: r.scheduled_at,
      durationMin: r.duration_min,
      status: r.status,
    }),
  });
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

/** Las tarjetas son altas: menos por página que las listas de filas. */
export const CLINICS_PAGE_SIZE = 20;

export interface ClinicMapEntry {
  clinicId: string;
  clinicName: string;
  plan: string;
  suspended: boolean;
  /** Cancelación pedida: conserva el plan hasta currentPeriodEnd (migración 0041). */
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  doctors: { id: string; fullName: string; email: string; role: UserRole }[];
  patientCount: number;
  /** Segundos de transcripción consumidos en el ciclo vigente de la clínica (0039, 0041). */
  transcriptionSecondsCycle: number;
}

interface ClinicRow {
  id: string;
  name: string;
  plan: string;
  suspended_at: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  users: { id: string; full_name: string; email: string; role: UserRole }[] | null;
}

/**
 * Conteo de pacientes y consumo de transcripción del ciclo, solo de las
 * clínicas pedidas, vía get_platform_clinic_stats() (migración 0052):
 * SECURITY DEFINER, solo conteos y segundos, sin PII. NO lee filas de
 * `patients`, a las que el super-admin no tiene acceso vía RLS (migración 0015).
 */
async function getClinicStats(
  supabase: ServerClient,
  clinicIds: string[],
): Promise<Map<string, { patientCount: number; transcriptionSecondsCycle: number }>> {
  if (clinicIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("get_platform_clinic_stats", {
    p_clinic_ids: clinicIds,
  });
  if (error) throw error;
  return new Map(
    (data ?? []).map((r) => [
      r.clinic_id,
      {
        patientCount: Number(r.patient_count),
        transcriptionSecondsCycle: Number(r.transcription_seconds_cycle),
      },
    ]),
  );
}

/**
 * Clínicas con sus profesionales, conteo de pacientes y consumo de
 * transcripción del ciclo vigente (el "mapa"), lo más reciente primero y con
 * búsqueda por nombre. Los conteos se piden solo para la página mostrada.
 */
export async function getClinicMap(params: ListParams): Promise<ListPage<ClinicMapEntry>> {
  const supabase = await createClient();
  const search = ilikeCondition("name", params.query);
  const countClinics = () => supabase.from("clinics").select("id", { count: "exact", head: true });

  const list = await fetchListPage({
    params,
    pageSize: CLINICS_PAGE_SIZE,
    countTotal: countClinics,
    countMatched: () => countClinics().or(search),
    fetchRows: (from, to) => {
      let query = supabase
        .from("clinics")
        .select(
          "id, name, plan, suspended_at, cancel_at_period_end, current_period_end, " +
            "users:users!users_clinic_id_fkey(id, full_name, email, role)",
        )
        // Solo el personal: las cuentas de paciente ni siquiera salen de la BD.
        .neq("users.role", "paciente");
      if (params.query) query = query.or(search);
      return query.order("created_at", { ascending: false }).order("id").range(from, to);
    },
    map: (row: ClinicRow) => row,
  });

  const stats = await getClinicStats(
    supabase,
    list.items.map((c) => c.id),
  );

  return {
    ...list,
    items: list.items.map((c) => ({
      clinicId: c.id,
      clinicName: c.name,
      plan: c.plan,
      suspended: Boolean(c.suspended_at),
      cancelAtPeriodEnd: c.cancel_at_period_end,
      currentPeriodEnd: c.current_period_end,
      doctors: (c.users ?? []).map((u) => ({
        id: u.id,
        fullName: u.full_name,
        email: u.email,
        role: u.role,
      })),
      patientCount: stats.get(c.id)?.patientCount ?? 0,
      transcriptionSecondsCycle: stats.get(c.id)?.transcriptionSecondsCycle ?? 0,
    })),
  };
}
