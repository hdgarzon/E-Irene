import { createClient } from "@/lib/supabase/server";

export interface PlatformClinicOverview {
  clinicId: string;
  clinicName: string;
  slug: string;
  plan: string;
  createdAt: string;
  suspendedAt: string | null;
  doctorCount: number;
  patientCount: number;
  consultationCount: number;
  reportCount: number;
  appointmentCount: number;
  notificationsSent: number;
}

interface RpcRow {
  clinic_id: string;
  clinic_name: string;
  slug: string;
  plan: string;
  created_at: string;
  suspended_at: string | null;
  doctor_count: number;
  patient_count: number;
  consultation_count: number;
  report_count: number;
  appointment_count: number;
  notifications_sent: number;
}

/**
 * Vista de negocio de TODAS las clínicas de la plataforma — nombre, plan,
 * fecha, estado y conteos agregados (pacientes, doctores, consultas,
 * reportes, citas, notificaciones). NUNCA expone datos clínicos: la función
 * de base de datos solo devuelve metadatos y conteos, y solo a platform admins.
 */
export async function getPlatformClinicOverview(): Promise<PlatformClinicOverview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_platform_clinic_overview");
  if (error) throw error;
  return (data as unknown as RpcRow[]).map((r) => ({
    clinicId: r.clinic_id,
    clinicName: r.clinic_name,
    slug: r.slug,
    plan: r.plan,
    createdAt: r.created_at,
    suspendedAt: r.suspended_at,
    doctorCount: Number(r.doctor_count),
    patientCount: Number(r.patient_count),
    consultationCount: Number(r.consultation_count),
    reportCount: Number(r.report_count),
    appointmentCount: Number(r.appointment_count),
    notificationsSent: Number(r.notifications_sent),
  }));
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
