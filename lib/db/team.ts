import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/auth";

export interface Member {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

/** Miembros de la clínica del usuario (RLS scoped). */
export async function listMembers(): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((u) => ({
    id: u.id,
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    createdAt: u.created_at,
  }));
}

/**
 * Crea un miembro del equipo. Usa el admin client (service-role) para
 * provisionar el usuario de auth y su perfil. SOLO debe invocarse tras
 * verificar que el actor es admin de la clínica.
 */
export async function addMember(
  clinicId: string,
  input: { fullName: string; email: string; password: string; role: UserRole },
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = data.user.id;

  const { error: profileErr } = await admin.from("users").insert({
    id: userId,
    clinic_id: clinicId,
    full_name: input.fullName,
    email: input.email,
    role: input.role,
  });
  if (profileErr) throw profileErr;

  if (input.role === "doctor" || input.role === "admin") {
    await admin.from("clinic_doctors").insert({ clinic_id: clinicId, doctor_id: userId });
  }
}
