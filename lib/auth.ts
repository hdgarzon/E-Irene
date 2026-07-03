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
  clinicSuspended: boolean;
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

  // Embed desambiguado: existen 2 relaciones users↔clinics (FK directa y vía
  // clinic_doctors), así que fijamos la FK directa por su nombre.
  const { data: profile } = await supabase
    .from("users")
    .select("role, full_name, email, clinic_id, clinic:clinics!users_clinic_id_fkey(name, suspended_at)")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: user.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    clinicId: profile.clinic_id,
    clinicName: profile.clinic?.name ?? "",
    clinicSuspended: Boolean(profile.clinic?.suspended_at),
  };
});

/**
 * Exige sesión; redirige a /login si no hay. Si la clínica está suspendida,
 * bloquea el acceso a la app (redirige a /suspendida) — salvo que el usuario
 * sea platform admin, que siempre puede entrar para reactivarla.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.clinicSuspended && !(await isPlatformAdmin())) redirect("/suspendida");
  return user;
}

/** Exige uno de los roles; redirige a /dashboard si no cumple. */
export async function requireRole(roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

/**
 * true si el usuario actual es super-admin de plataforma (acceso de solo
 * negocio a todas las clínicas — ver platform_admins / is_platform_admin()
 * en la base de datos). No hay forma de auto-otorgarse este rol desde la
 * app; se concede insertando directamente en la tabla.
 */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return data === true;
});

/** Exige que el usuario sea super-admin de plataforma; si no, redirige a /dashboard. */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await isPlatformAdmin())) redirect("/dashboard");
  return user;
}
