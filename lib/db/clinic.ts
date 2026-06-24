import { createClient } from "@/lib/supabase/server";
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
