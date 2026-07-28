import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import type { RiskAlertCategory } from "@/lib/risk-flags";
import { listDoctorsPublic, type DoctorContact } from "@/lib/db/clinic";
import { isPhq9SelfHarmRisk, type AssessmentType } from "@/lib/psychometrics";
import { getPatientForLink } from "@/lib/db/patients";
import { getEmailProvider } from "@/lib/email/providers";
import { buildPhq9RiskAlertEmail } from "@/lib/email/templates";
import { recordNotificationPublic } from "@/lib/db/notifications";
import { logAuditPublic } from "@/lib/db/audit";

/**
 * Dos fuentes de riesgo, un solo mecanismo de persistencia y acuse de
 * recibo (ver migración 0026): el análisis de IA de una sesión, o una
 * respuesta de riesgo en un PHQ-9 autorreportado vía link público (sin
 * sesión de personal).
 */
export type RiskAlertSource = "session_analysis" | "phq9_self_report";

export interface RiskAlert {
  id: string;
  source: RiskAlertSource;
  patientId: string;
  patientName: string;
  date: string;
  /** Solo presente cuando `source === "session_analysis"`. */
  consultationId: string | null;
  categories: RiskAlertCategory[];
}

type CreateRiskAlertInput =
  | {
      source: "session_analysis";
      consultationId: string;
      patientId: string;
      doctorId: string;
      categories: RiskAlertCategory[];
    }
  | {
      source: "phq9_self_report";
      assessmentId: string;
      patientId: string;
      /** `null` si se notificó a todo el personal admin/doctor (sin una cita próxima que dé un destinatario único). */
      doctorId: string | null;
      categories: RiskAlertCategory[];
    };

/**
 * Registra una alerta de riesgo. Debe llamarse ANTES de cualquier efecto que
 * dependa de que la alerta ya exista (crear el reporte de sesión, enviar el
 * correo al doctor) — un fallo posterior no debe dejar la alerta sin
 * persistir.
 *
 * Idempotente por origen: un índice único parcial sobre `consultation_id`
 * (fuente IA) o `assessment_id` (fuente PHQ-9) hace que una segunda llamada
 * para el mismo origen sea un no-op — `isNew: false` le indica al llamador
 * que NO debe reenviar el correo.
 *
 * Usa el cliente service-role para la fuente PHQ-9 (corre desde el flujo de
 * link público, sin sesión de personal) y el cliente de sesión para la
 * fuente de análisis de IA (corre desde una Server Action autenticada).
 */
export async function createRiskAlert(
  clinicId: string,
  input: CreateRiskAlertInput,
): Promise<{ id: string; isNew: boolean }> {
  const supabase = input.source === "phq9_self_report" ? createAdminClient() : await createClient();
  const conflictColumn = input.source === "session_analysis" ? "consultation_id" : "assessment_id";
  const conflictValue = input.source === "session_analysis" ? input.consultationId : input.assessmentId;

  const { data, error } = await supabase
    .from("risk_alerts")
    .insert({
      clinic_id: clinicId,
      source: input.source,
      consultation_id: input.source === "session_analysis" ? input.consultationId : null,
      assessment_id: input.source === "phq9_self_report" ? input.assessmentId : null,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      categories_enc: encrypt(JSON.stringify(input.categories)),
    })
    .select("id")
    .single();

  if (!error) return { id: data.id, isNew: true };

  // 23505 = unique_violation (Postgres) → ya existe una alerta para este
  // origen. No es un error real, es el camino esperado de un reintento.
  if (error.code === "23505") {
    const existing = await supabase
      .from("risk_alerts")
      .select("id")
      .eq(conflictColumn, conflictValue)
      .single();
    if (existing.error) throw existing.error;
    return { id: existing.data.id, isNew: false };
  }
  throw error;
}

interface RiskAlertRow {
  id: string;
  source: RiskAlertSource;
  consultation_id: string | null;
  patient_id: string;
  categories_enc: string;
  created_at: string;
  patients: { full_name_enc: string } | null;
  consultations: { started_at: string } | null;
}

/**
 * Alertas de riesgo abiertas (sin acuse de recibo) de la clínica del
 * usuario, más recientes primero — de ambas fuentes. Apoyo a la detección
 * temprana — NUNCA un diagnóstico. Si una fila no descifra (p. ej. tras
 * rotar ENCRYPTION_KEY sin migrar datos antiguos), se omite en vez de
 * romper toda la lista.
 */
export async function listOpenRiskAlerts(limit = 50): Promise<RiskAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("risk_alerts")
    .select(
      "id, source, consultation_id, patient_id, categories_enc, created_at, " +
        "patients!risk_alerts_patient_id_fkey(full_name_enc), " +
        "consultations!risk_alerts_consultation_id_fkey(started_at)",
    )
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data as unknown as RiskAlertRow[];
  const alerts: RiskAlert[] = [];
  for (const r of rows) {
    let categories: RiskAlertCategory[];
    try {
      categories = JSON.parse(decrypt(r.categories_enc)) as RiskAlertCategory[];
    } catch (error) {
      logger.warn("risk_alert.decrypt_failed", { alertId: r.id, error });
      continue;
    }
    let patientName = "(nombre no disponible)";
    if (r.patients?.full_name_enc) {
      try {
        patientName = decrypt(r.patients.full_name_enc);
      } catch {
        // se mantiene el placeholder
      }
    }
    alerts.push({
      id: r.id,
      source: r.source,
      consultationId: r.consultation_id,
      patientId: r.patient_id,
      patientName,
      date: r.consultations?.started_at ?? r.created_at,
      categories,
    });
  }
  return alerts;
}

/** El doctor (o admin) acusa recibo de la alerta — queda fuera de la cola abierta. */
export async function acknowledgeRiskAlert(alertId: string, userId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("risk_alerts")
    .update({ acknowledged_by: userId, acknowledged_at: new Date().toISOString() })
    .eq("id", alertId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────
// Fuente: PHQ-9 autorreportado vía link público
// ─────────────────────────────────────────────────────────────────────────

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
 * Si la escala indica riesgo (autolesión en el PHQ-9), registra la alerta
 * (fuente "phq9_self_report", ver `createRiskAlert`) y avisa por correo al
 * doctor de la próxima cita del paciente (o, si no hay ninguna, a todo el
 * personal admin/doctor de la clínica). Nunca lanza excepción — un fallo de
 * resolución o envío se loguea, pero no debe afectar al caller (la escala
 * ya quedó guardada).
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
    const recipients = nextDoctor ? [nextDoctor] : await listDoctorsPublic(params.clinicId);

    if (recipients.length === 0) {
      await logAuditPublic({
        clinicId: params.clinicId,
        action: "assessment.risk_alert_no_recipient",
        entityType: "psychometric_assessment",
        entityId: params.assessmentId,
      });
      return;
    }

    const { isNew } = await createRiskAlert(params.clinicId, {
      source: "phq9_self_report",
      assessmentId: params.assessmentId,
      patientId: params.patientId,
      doctorId: nextDoctor?.id ?? null,
      categories: [
        { key: "self_harm", level: "alto", evidence: "Ítem de autolesión del PHQ-9 con respuesta positiva." },
      ],
    });
    // Igual que la fuente de análisis de IA: solo se avisa por correo la
    // primera vez — un reintento (p. ej. el paciente reenvía el mismo link)
    // no debe reenviar el aviso al doctor.
    if (!isNew) return;

    const patientName = patient?.fullName ?? "(nombre no disponible)";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://e-irene.co";
    const patientUrl = `${appUrl}/patients/${params.patientId}`;

    const notifyDoctor = async (doctor: DoctorContact): Promise<void> => {
      try {
        await getEmailProvider().send(
          buildPhq9RiskAlertEmail({
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
    };

    await Promise.allSettled(recipients.map(notifyDoctor));

    await logAuditPublic({
      clinicId: params.clinicId,
      action: "assessment.risk_alert_sent",
      entityType: "psychometric_assessment",
      entityId: params.assessmentId,
      metadata: { recipientCount: recipients.length },
    });
  } catch (error) {
    // Resolución de destinatario (query a appointments/patients) o registro
    // de la alerta falló — no debe bloquear el guardado de la escala, que
    // ya ocurrió.
    logger.error("risk_alert.resolution_failed", {
      clinicId: params.clinicId,
      patientId: params.patientId,
      assessmentId: params.assessmentId,
      error,
    });
  }
}
