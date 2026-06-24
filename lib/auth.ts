import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type UserRole = "admin" | "doctor" | "secretaria" | "paciente";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
}

/**
 * Devuelve el usuario autenticado con su perfil (rol + clínica), o null.
 * `cache()` evita consultas repetidas dentro del mismo render.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("role, full_name, email, clinic_id, clinics(name)")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: user.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    clinicId: profile.clinic_id,
    clinicName: profile.clinics?.name ?? "",
  };
});

/** Exige sesión; redirige a /login si no hay. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Exige uno de los roles; redirige a /dashboard si no cumple. */
export async function requireRole(roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}
