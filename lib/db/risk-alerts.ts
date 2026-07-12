// lib/db/risk-alerts.ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { DoctorContact } from "@/lib/db/clinic";

/**
 * Doctor de la cita futura más próxima del paciente (no cancelada). Usa el
 * cliente service-role porque esta resolución corre desde el flujo de link
 * público, sin sesión de personal.
 */
export async function getNextAppointmentDoctor(patientId: string): Promise<DoctorContact | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("appointments")
    .select("doctor:users!appointments_doctor_id_fkey(id, full_name, email)")
    .eq("patient_id", patientId)
    .neq("status", "cancelled")
    .gt("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const doctor = (data as unknown as { doctor: { id: string; full_name: string; email: string } | null } | null)
    ?.doctor;
  if (!doctor) return null;
  return { id: doctor.id, fullName: doctor.full_name, email: doctor.email };
}
