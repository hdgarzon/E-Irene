// lib/db/risk-alerts.ts
import { createAdminClient } from "@/lib/supabase/admin";
import { listDoctorsPublic, type DoctorContact } from "@/lib/db/clinic";
import { isPhq9SelfHarmRisk, type AssessmentType } from "@/lib/psychometrics";
import { getPatientForLink } from "@/lib/db/patients";
import { getEmailProvider } from "@/lib/email/providers";
import { buildRiskAlertEmail } from "@/lib/email/templates";
import { recordNotificationPublic } from "@/lib/db/notifications";
import { logAuditPublic } from "@/lib/db/audit";
import { logger } from "@/lib/logger";

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

/**
 * Nombre de la clínica sin sesión (cliente service-role). `clinics.name` no
 * está cifrado — es información de la clínica, no un dato del paciente.
 */
async function getClinicNamePublic(clinicId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("clinics").select("name").eq("id", clinicId).single();
  if (error) throw error;
  return data.name;
}

/**
 * Si la escala indica riesgo (autolesión en el PHQ-9), avisa por correo al
 * doctor de la próxima cita del paciente (o, si no hay ninguna, a todo el
 * personal admin/doctor de la clínica). Nunca lanza excepción — un fallo de
 * envío se loguea y se registra como notificación fallida, pero no debe
 * afectar al caller (la escala ya quedó guardada).
 */
export async function alertOnRiskyAssessment(params: {
  clinicId: string;
  patientId: string;
  assessmentId: string;
  type: AssessmentType;
  answers: number[];
}): Promise<void> {
  if (!isPhq9SelfHarmRisk(params.type, params.answers)) return;

  try {
    const [nextDoctor, patient, clinicName] = await Promise.all([
      getNextAppointmentDoctor(params.patientId),
      getPatientForLink(params.patientId),
      getClinicNamePublic(params.clinicId),
    ]);
    const recipients = nextDoctor
      ? [nextDoctor]
      : await listDoctorsPublic(params.clinicId);

    if (recipients.length === 0) {
      await logAuditPublic({
        clinicId: params.clinicId,
        action: "assessment.risk_alert_no_recipient",
        entityType: "psychometric_assessment",
        entityId: params.assessmentId,
      });
      return;
    }

    const patientName = patient?.fullName ?? "(nombre no disponible)";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://e-irene.co";
    const patientUrl = `${appUrl}/patients/${params.patientId}`;

    for (const doctor of recipients) {
      try {
        await getEmailProvider().send(
          buildRiskAlertEmail({
            to: doctor.email,
            doctorName: doctor.fullName,
            patientName,
            clinicName,
            patientUrl,
          }),
        );
        try {
          await recordNotificationPublic(params.clinicId, {
            patientId: params.patientId,
            type: "risk_alert",
            status: "sent",
          });
        } catch (recordError) {
          logger.warn("risk_alert.record_notification_failed", {
            clinicId: params.clinicId,
            patientId: params.patientId,
            assessmentId: params.assessmentId,
            doctorId: doctor.id,
            status: "sent",
            error: recordError,
          });
        }
      } catch (error) {
        logger.warn("risk_alert.send_failed", {
          clinicId: params.clinicId,
          patientId: params.patientId,
          assessmentId: params.assessmentId,
          doctorId: doctor.id,
          to: doctor.email,
          error,
        });
        try {
          await recordNotificationPublic(params.clinicId, {
            patientId: params.patientId,
            type: "risk_alert",
            status: "failed",
          });
        } catch (recordError) {
          logger.warn("risk_alert.record_notification_failed", {
            clinicId: params.clinicId,
            patientId: params.patientId,
            assessmentId: params.assessmentId,
            doctorId: doctor.id,
            status: "failed",
            error: recordError,
          });
        }
      }
    }

    await logAuditPublic({
      clinicId: params.clinicId,
      action: "assessment.risk_alert_sent",
      entityType: "psychometric_assessment",
      entityId: params.assessmentId,
      metadata: { recipientCount: recipients.length },
    });
  } catch (error) {
    // Resolución de destinatario (query a appointments/patients) falló —
    // no debe bloquear el guardado de la escala, que ya ocurrió.
    logger.error("risk_alert.resolution_failed", {
      clinicId: params.clinicId,
      patientId: params.patientId,
      assessmentId: params.assessmentId,
      error,
    });
  }
}
