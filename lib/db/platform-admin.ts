import { createClient } from "@/lib/supabase/server";

export interface PlatformTotals {
  clinics: number;
  patients: number;
  consultations: number;
  reports: number;
  appointments: number;
  notificationsSent: number;
}

/**
 * Totales de negocio de TODA la plataforma en una sola fila
 * (get_platform_totals, migración 0047). NUNCA expone datos clínicos: la
 * función solo devuelve conteos, y solo a platform admins.
 *
 * No sumar get_platform_clinic_overview() en la app: devuelve una fila por
 * clínica y PostgREST la corta en 1000, así que pasadas las 1000 clínicas el
 * resumen contaba y sumaba solo esas.
 */
export async function getPlatformTotals(): Promise<PlatformTotals> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_platform_totals").single();
  if (error) throw error;
  return {
    clinics: Number(data.clinic_count),
    patients: Number(data.patient_count),
    consultations: Number(data.consultation_count),
    reports: Number(data.report_count),
    appointments: Number(data.appointment_count),
    notificationsSent: Number(data.notifications_sent),
  };
}

/** Desglose global de citas por estado (conteos, sin datos de paciente). */
export async function getPlatformAppointmentStatus(): Promise<{ status: string; count: number }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_platform_appointment_status");
  if (error) throw error;
  return (data as unknown as { status: string; count: number }[]).map((r) => ({
    status: r.status,
    count: Number(r.count),
  }));
}

/** Cambia el plan de una clínica (solo platform admin). */
export async function setClinicPlan(clinicId: string, plan: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_clinic_plan", {
    target_clinic: clinicId,
    new_plan: plan,
  });
  if (error) throw error;
}

/** Suspende o reactiva una clínica (solo platform admin). */
export async function setClinicSuspended(clinicId: string, suspend: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("platform_set_clinic_suspended", {
    target_clinic: clinicId,
    suspend,
  });
  if (error) throw error;
}
