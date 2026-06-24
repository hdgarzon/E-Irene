import { createClient } from "@/lib/supabase/server";

export interface DoctorOption {
  id: string;
  fullName: string;
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
