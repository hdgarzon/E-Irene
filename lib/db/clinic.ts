import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Plan } from "@/lib/plans";

export interface DoctorOption {
  id: string;
  fullName: string;
}

export interface ClinicOverview {
  plan: Plan;
  patientCount: number;
  doctorCount: number;
  memberCount: number;
}

/** Plan + conteos de la clínica del usuario (RLS scoped). */
export async function getClinicOverview(): Promise<ClinicOverview> {
  const supabase = await createClient();
  const [clinic, patients, doctors, members] = await Promise.all([
    supabase.from("clinics").select("plan").single(),
    supabase.from("patients").select("*", { count: "exact", head: true }),
    supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .in("role", ["admin", "doctor"]),
    supabase.from("users").select("*", { count: "exact", head: true }),
  ]);
  return {
    plan: (clinic.data?.plan ?? "free") as Plan,
    patientCount: patients.count ?? 0,
    doctorCount: doctors.count ?? 0,
    memberCount: members.count ?? 0,
  };
}

export async function setClinicPlan(clinicId: string, plan: Plan): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("clinics").update({ plan }).eq("id", clinicId);
  if (error) throw error;
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
