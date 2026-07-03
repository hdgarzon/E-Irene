import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, encryptNullable, decrypt, decryptNullable } from "@/lib/crypto";
import type { UserRole } from "@/lib/auth";

function safeName(enc: string | null | undefined): string {
  if (!enc) return "—";
  try {
    return decrypt(enc);
  } catch {
    return "(no disponible)";
  }
}

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

// ================================ Pacientes =================================

export interface AdminPatient {
  id: string;
  fullName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
  clinicId: string;
  clinicName: string;
}

const PATIENT_COLS =
  "id, full_name_enc, document_enc, phone_enc, email_enc, birth_date, gender, " +
  "emergency_contact_name_enc, emergency_contact_phone_enc, emergency_contact_relationship_enc, " +
  "clinic_id, clinics:clinics!patients_clinic_id_fkey(name)";

interface AdminPatientRow {
  id: string;
  full_name_enc: string;
  document_enc: string | null;
  phone_enc: string | null;
  email_enc: string | null;
  birth_date: string | null;
  gender: string | null;
  emergency_contact_name_enc: string | null;
  emergency_contact_phone_enc: string | null;
  emergency_contact_relationship_enc: string | null;
  clinic_id: string;
  clinics: { name: string } | null;
}

function mapAdminPatient(r: AdminPatientRow): AdminPatient {
  return {
    id: r.id,
    fullName: safeName(r.full_name_enc),
    document: decryptNullable(r.document_enc),
    phone: decryptNullable(r.phone_enc),
    email: decryptNullable(r.email_enc),
    birthDate: r.birth_date,
    gender: r.gender,
    emergencyContactName: decryptNullable(r.emergency_contact_name_enc),
    emergencyContactPhone: decryptNullable(r.emergency_contact_phone_enc),
    emergencyContactRelationship: decryptNullable(r.emergency_contact_relationship_enc),
    clinicId: r.clinic_id,
    clinicName: r.clinics?.name ?? "—",
  };
}

export async function listAllPatients(): Promise<AdminPatient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_COLS)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as AdminPatientRow[]).map(mapAdminPatient);
}

export async function getAdminPatient(id: string): Promise<AdminPatient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patients")
    .select(PATIENT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapAdminPatient(data as unknown as AdminPatientRow) : null;
}

export interface AdminPatientInput {
  fullName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  gender: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
}

/**
 * Actualiza SOLO identidad/contacto del paciente. NUNCA toca notes_enc ni
 * history_enc (contenido clínico que el maestro no debe ver ni sobrescribir).
 */
export async function updatePatientAdmin(id: string, input: AdminPatientInput): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("patients")
    .update({
      full_name_enc: encrypt(input.fullName),
      document_enc: encryptNullable(input.document),
      phone_enc: encryptNullable(input.phone),
      email_enc: encryptNullable(input.email),
      birth_date: input.birthDate,
      gender: input.gender,
      emergency_contact_name_enc: encryptNullable(input.emergencyContactName),
      emergency_contact_phone_enc: encryptNullable(input.emergencyContactPhone),
      emergency_contact_relationship_enc: encryptNullable(input.emergencyContactRelationship),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Elimina el paciente y, por cascade, TODO su historial (irreversible). */
export async function deletePatientAdmin(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("patients").delete().eq("id", id);
  if (error) throw error;
}

// ================================== Citas ===================================

export interface AdminAppointment {
  id: string;
  patientName: string;
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
        "patients:patients!appointments_patient_id_fkey(full_name_enc), " +
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
      patients: { full_name_enc: string } | null;
      doctor: { full_name: string } | null;
      clinics: { name: string } | null;
    }[]
  ).map((r) => ({
    id: r.id,
    patientName: safeName(r.patients?.full_name_enc),
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

/** Clínicas con sus doctores y conteo de pacientes (el "mapa"). */
export async function getClinicMap(): Promise<ClinicMapEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clinics")
    .select(
      "id, name, plan, suspended_at, " +
        "users:users!users_clinic_id_fkey(id, full_name, email, role), " +
        "patients:patients!patients_clinic_id_fkey(id)",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (
    data as unknown as {
      id: string;
      name: string;
      plan: string;
      suspended_at: string | null;
      users: { id: string; full_name: string; email: string; role: UserRole }[];
      patients: { id: string }[];
    }[]
  ).map((c) => ({
    clinicId: c.id,
    clinicName: c.name,
    plan: c.plan,
    suspended: Boolean(c.suspended_at),
    doctors: (c.users ?? [])
      .filter((u) => u.role !== "paciente")
      .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, role: u.role })),
    patientCount: (c.patients ?? []).length,
  }));
}
