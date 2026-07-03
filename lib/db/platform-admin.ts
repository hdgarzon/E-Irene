import { createClient } from "@/lib/supabase/server";

export interface PlatformClinicOverview {
  clinicId: string;
  clinicName: string;
  slug: string;
  plan: string;
  createdAt: string;
  doctorCount: number;
  patientCount: number;
  consultationCount: number;
}

interface RpcRow {
  clinic_id: string;
  clinic_name: string;
  slug: string;
  plan: string;
  created_at: string;
  doctor_count: number;
  patient_count: number;
  consultation_count: number;
}

/**
 * Vista de negocio de TODAS las clínicas de la plataforma — nombre, plan,
 * fecha de registro, conteos agregados. NUNCA expone datos clínicos
 * (nombres de pacientes, transcripciones, reportes): la función de base de
 * datos que respalda esto (get_platform_clinic_overview) solo devuelve
 * metadatos de clínica y conteos, y solo si el usuario es platform admin.
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
    doctorCount: Number(r.doctor_count),
    patientCount: Number(r.patient_count),
    consultationCount: Number(r.consultation_count),
  }));
}
