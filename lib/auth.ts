import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAccessClinical, type VerificationStatus } from "@/lib/verification";

export type UserRole = "admin" | "doctor" | "secretaria" | "paciente";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  clinicId: string;
  clinicName: string;
  clinicSuspended: boolean;
  verificationStatus: VerificationStatus;
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
    .select(
      "role, full_name, email, clinic_id, verification_status, clinic:clinics!users_clinic_id_fkey(name, suspended_at)",
    )
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
    verificationStatus: profile.verification_status,
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
 * true si la clínica tiene al menos un profesional verificado. Solo importa
 * para secretarías: no ejercen, pero registran pacientes por cuenta de quien
 * sí lo hace.
 */
const clinicHasVerifiedProfessional = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { count } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .in("role", ["admin", "doctor"])
    .eq("verification_status", "verified");
  return (count ?? 0) > 0;
});

/**
 * Exige verificación de habilitación profesional para las rutas que crean o
 * manipulan registros clínicos. Redirige a /verificacion, que explica qué falta.
 *
 * Este guard es de experiencia de usuario: quien de verdad bloquea es la
 * política RLS `auth_can_access_clinical()` (migración 0032), que también
 * cubre las llamadas directas a la API.
 */
export async function requireVerifiedProfessional(): Promise<SessionUser> {
  const user = await requireUser();
  const allowed = canAccessClinical({
    role: user.role,
    status: user.verificationStatus,
    clinicHasVerifiedProfessional:
      user.role === "secretaria" ? await clinicHasVerifiedProfessional() : undefined,
  });
  if (!allowed) redirect("/verificacion");
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
