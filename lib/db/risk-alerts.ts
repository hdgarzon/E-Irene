import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import type { RiskAlertCategory } from "@/lib/risk-flags";
import { listDoctorsPublic, type DoctorContact } from "@/lib/db/clinic";
import { isPhq9SelfHarmRisk, type AssessmentType } from "@/lib/psychometrics";
import { isPhq9SelfHarmPayload } from "@/lib/db/assessments";
import { getPatientForLink } from "@/lib/db/patients";
import { getEmailProvider } from "@/lib/email/providers";
import { buildPhq9RiskAlertEmail } from "@/lib/email/templates";
import { recordNotificationPublic, statusForDeliveryMode } from "@/lib/db/notifications";
import { logAuditPublic } from "@/lib/db/audit";
import { appBaseUrl } from "@/lib/app-url";

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
  /**
   * `null` si no se pudo descifrar (p. ej. tras rotar ENCRYPTION_KEY sin
   * migrar datos antiguos). La alerta se lista igual: sigue abierta y sigue
   * siendo sobre un paciente concreto.
   */
  categories: RiskAlertCategory[] | null;
}

/** Una página de la cola abierta de una fuente, con el total real de esa fuente. */
export interface RiskAlertQueue {
  alerts: RiskAlert[];
  /** Alertas abiertas de la fuente en la clínica, no solo las que trae `alerts`. */
  total: number;
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
      /**
       * Cuándo reportó el paciente el riesgo. Solo lo pasa la conciliación,
       * que registra alertas tiempo después del envío: sin esto aparecerían en
       * la cola como si fueran de hoy. Por omisión, ahora.
       */
      createdAt?: string;
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
 * Usa el cliente service-role en las dos fuentes. La PHQ-9 corre desde el
 * flujo de link público, sin sesión de personal. La de análisis de IA corre
 * con la sesión de quien terminó o reintentó la consulta —cualquier rol—, pero
 * lo que esa sesión puede insertar en `risk_alerts` está acotado (migración
 * 0047) y se va a retirar: la alerta la registra el servidor. El llamador
 * responde por los datos: `clinicId` de la sesión, y paciente y doctor leídos
 * de la consulta bajo RLS.
 */
export async function createRiskAlert(
  clinicId: string,
  input: CreateRiskAlertInput,
): Promise<{ id: string; isNew: boolean }> {
  const supabase = createAdminClient();
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
      ...(input.source === "phq9_self_report" && input.createdAt ? { created_at: input.createdAt } : {}),
    })
    .select("id")
    .single();

  if (!error) return { id: data.id, isNew: true };

  // 23505 = unique_violation (Postgres) → ya existe una alerta para este
  // origen. No es un error real, es el camino esperado de un reintento.
  if (error.code === "23505") {
    // Acotada a la clínica: service-role no filtra por RLS, y una alerta de
    // otra clínica con el mismo origen no es un reintento. Nunca debe volverse
    // un `isNew: false` que calle el correo: si aparece, esto lanza y se ve.
    const existing = await supabase
      .from("risk_alerts")
      .select("id")
      .eq("clinic_id", clinicId)
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
 * Alertas de riesgo abiertas (sin acuse de recibo) de una fuente, más
 * recientes primero, junto con el total de abiertas de esa fuente: quien
 * muestra solo unas pocas tiene que poder decir cuántas faltan. Apoyo a la
 * detección temprana — NUNCA un diagnóstico.
 *
 * Una fila que no descifra (p. ej. tras rotar ENCRYPTION_KEY sin migrar datos
 * antiguos) no se omite: se devuelve con `categories: null`. Omitirla dejaría
 * una alerta abierta que nadie ve pero que el total sí cuenta.
 */
export async function listOpenRiskAlerts(
  source: RiskAlertSource,
  limit: number,
): Promise<RiskAlertQueue> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("risk_alerts")
    .select(
      "id, source, consultation_id, patient_id, categories_enc, created_at, " +
        "patients!risk_alerts_patient_id_fkey(full_name_enc), " +
        "consultations!risk_alerts_consultation_id_fkey(started_at)",
      { count: "exact" },
    )
    .eq("source", source)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data as unknown as RiskAlertRow[];
  const alerts = rows.map((r): RiskAlert => {
    let categories: RiskAlertCategory[] | null = null;
    try {
      categories = JSON.parse(decrypt(r.categories_enc)) as RiskAlertCategory[];
    } catch (error) {
      logger.warn("risk_alert.decrypt_failed", { alertId: r.id, error });
    }
    let patientName = "(nombre no disponible)";
    if (r.patients?.full_name_enc) {
      try {
        patientName = decrypt(r.patients.full_name_enc);
      } catch {
        // se mantiene el placeholder
      }
    }
    return {
      id: r.id,
      source: r.source,
      consultationId: r.consultation_id,
      patientId: r.patient_id,
      patientName,
      date: r.consultations?.started_at ?? r.created_at,
      categories,
    };
  });
  return { alerts, total: count ?? alerts.length };
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

/** Categoría fija de esta fuente: la única señal que se evalúa es el ítem 9. */
const PHQ9_SELF_HARM_CATEGORIES: RiskAlertCategory[] = [
  { key: "self_harm", level: "alto", evidence: "Ítem de autolesión del PHQ-9 con respuesta positiva." },
];

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
 * Marca un PHQ-9 vía link como evaluado (migración 0045). Llamar solo cuando
 * la alerta, si correspondía, ya quedó registrada: la marca es lo que saca al
 * PHQ-9 de la conciliación.
 */
async function markRiskEvaluated(assessmentId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("psychometric_assessments")
    .update({ risk_evaluated_at: new Date().toISOString() })
    .eq("id", assessmentId)
    .is("risk_evaluated_at", null);
  if (error) throw error;
}

/** `markRiskEvaluated` sin lanzar: si falla, el PHQ-9 solo queda pendiente y la conciliación lo vuelve a evaluar. */
async function markRiskEvaluatedQuietly(ctx: {
  clinicId: string;
  patientId: string;
  assessmentId: string;
}): Promise<void> {
  try {
    await markRiskEvaluated(ctx.assessmentId);
  } catch (error) {
    logger.warn("risk_alert.mark_evaluated_failed", { ...ctx, error });
  }
}

/**
 * Si la escala indica riesgo (autolesión en el PHQ-9), registra la alerta
 * (fuente "phq9_self_report", ver `createRiskAlert`) y avisa por correo al
 * doctor de la próxima cita del paciente (o, si no hay ninguna, a todo el
 * personal admin/doctor de la clínica). Nunca lanza excepción — un fallo de
 * resolución o envío se loguea, pero no debe afectar al caller (la escala
 * ya quedó guardada).
 *
 * La alerta se registra ANTES de resolver destinatarios o armar el correo: la
 * cola del dashboard no puede depender de que haya a quién avisar ni de que
 * esas consultas respondan. Si el registro mismo falla, el PHQ-9 queda sin
 * marca de evaluado y lo recoge `reconcilePendingPhq9RiskAlerts`.
 */
export async function alertOnRiskyAssessment(params: {
  clinicId: string;
  patientId: string;
  assessmentId: string;
  type: AssessmentType;
  answers: number[];
}): Promise<void> {
  if (params.type !== "phq9") return;
  const logContext = {
    clinicId: params.clinicId,
    patientId: params.patientId,
    assessmentId: params.assessmentId,
  };

  if (!isPhq9SelfHarmRisk(params.type, params.answers)) {
    await markRiskEvaluatedQuietly(logContext);
    return;
  }

  // En paralelo, pero ninguna condiciona el registro de la alerta. Si falla la
  // búsqueda del doctor de la próxima cita, se avisa a todo el personal
  // clínico, igual que cuando no hay cita.
  const [nextDoctorLookup, patientLookup, clinicNameLookup] = await Promise.allSettled([
    getNextAppointmentDoctor(params.patientId),
    getPatientForLink(params.patientId),
    getClinicNamePublic(params.clinicId),
  ]);
  if (nextDoctorLookup.status === "rejected") {
    logger.warn("risk_alert.next_doctor_failed", { ...logContext, error: nextDoctorLookup.reason });
  }
  const nextDoctor = nextDoctorLookup.status === "fulfilled" ? nextDoctorLookup.value : null;

  let isNew = true;
  try {
    ({ isNew } = await createRiskAlert(params.clinicId, {
      source: "phq9_self_report",
      assessmentId: params.assessmentId,
      patientId: params.patientId,
      doctorId: nextDoctor?.id ?? null,
      categories: PHQ9_SELF_HARM_CATEGORIES,
    }));
    await markRiskEvaluatedQuietly(logContext);
  } catch (error) {
    // Sin la fila no hay nada que acusar todavía, pero el correo sale igual:
    // es el único aviso inmediato. La conciliación registra la alerta después,
    // sin reenviar el correo.
    logger.error("risk_alert.persist_failed", { ...logContext, error });
  }
  // Igual que la fuente de análisis de IA: solo se avisa por correo la
  // primera vez — un reintento (p. ej. el paciente reenvía el mismo link)
  // no debe reenviar el aviso al doctor.
  if (!isNew) return;

  try {
    if (patientLookup.status === "rejected") throw patientLookup.reason;
    if (clinicNameLookup.status === "rejected") throw clinicNameLookup.reason;
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

    const patientName = patientLookup.value?.fullName ?? "(nombre no disponible)";
    const clinicName = clinicNameLookup.value;
    const patientUrl = `${appBaseUrl()}/patients/${params.patientId}`;

    const notifyDoctor = async (doctor: DoctorContact): Promise<void> => {
      try {
        const email = getEmailProvider();
        await email.send(
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
            status: statusForDeliveryMode(email.mode),
            payload: { mode: email.mode },
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
    // Resolución de destinatarios o de los datos del correo (query a
    // patients/clinics/users) falló. La alerta ya quedó registrada, o
    // pendiente de conciliación: esto no debe bloquear el guardado de la
    // escala, que ya ocurrió.
    logger.error("risk_alert.resolution_failed", { ...logContext, error });
  }
}

export interface Phq9ReconcileResult {
  /** PHQ-9 revisados y marcados en esta pasada, con o sin riesgo. */
  evaluated: number;
  /** Alertas que esta pasada registró en `risk_alerts`. */
  created: number;
  /** PHQ-9 que siguen pendientes: no se pudieron leer o falló el registro. */
  failed: number;
}

/** Por debajo del máximo de filas por respuesta de PostgREST. */
const RECONCILE_PAGE_SIZE = 200;

/**
 * Registra en `risk_alerts` la alerta de cada PHQ-9 de riesgo vía link que
 * todavía no esté evaluado (migración 0045), y marca como evaluados los que
 * no tienen riesgo. Es el backfill de lo anterior a 0026 y la red de
 * seguridad de `alertOnRiskyAssessment` cuando no llegó a registrar la alerta.
 *
 * Idempotente: una segunda pasada no crea nada (índice único por
 * `assessment_id`) y nunca reabre una alerta ya acusada — `createRiskAlert`
 * no toca la fila existente.
 *
 * No envía correos: lo que concilia es histórico (su aviso salió cuando el
 * paciente envió el PHQ-9) o una alerta cuyo correo ya se intentó en ese envío.
 *
 * Service-role porque escribe la marca, que `authenticated` no puede tocar;
 * siempre acotado a `clinicId`, que el llamador toma de la sesión. Un PHQ-9
 * que no se puede leer se loguea y queda pendiente: nunca se da por "sin
 * riesgo".
 */
export async function reconcilePendingPhq9RiskAlerts(clinicId: string): Promise<Phq9ReconcileResult> {
  const admin = createAdminClient();
  const result: Phq9ReconcileResult = { evaluated: 0, created: 0, failed: 0 };
  let afterId: string | null = null;

  for (;;) {
    let query = admin
      .from("psychometric_assessments")
      .select("id, patient_id, type, payload_enc, administered_at")
      .eq("clinic_id", clinicId)
      .eq("type", "phq9")
      .not("link_id", "is", null)
      .is("risk_evaluated_at", null);
    // Cursor por id: los PHQ-9 que no se pueden evaluar siguen pendientes, y
    // sin cursor la misma página volvería una y otra vez.
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query.order("id", { ascending: true }).limit(RECONCILE_PAGE_SIZE);
    if (error) throw error;

    for (const row of data) {
      const ctx = { clinicId, patientId: row.patient_id, assessmentId: row.id };

      let risky: boolean;
      try {
        risky = isPhq9SelfHarmPayload(row.type as AssessmentType, row.payload_enc);
      } catch (error) {
        result.failed++;
        logger.error("risk_alert.reconcile_unreadable", { ...ctx, error });
        continue;
      }

      try {
        if (risky) {
          const alert = await createRiskAlert(clinicId, {
            source: "phq9_self_report",
            assessmentId: row.id,
            patientId: row.patient_id,
            doctorId: null,
            categories: PHQ9_SELF_HARM_CATEGORIES,
            createdAt: row.administered_at,
          });
          if (alert.isNew) {
            result.created++;
            await logAuditPublic({
              clinicId,
              action: "assessment.risk_alert_reconciled",
              entityType: "psychometric_assessment",
              entityId: row.id,
              metadata: { alertId: alert.id },
            });
          }
        }
        await markRiskEvaluated(row.id);
        result.evaluated++;
      } catch (error) {
        result.failed++;
        logger.error("risk_alert.reconcile_failed", { ...ctx, error });
      }
    }

    if (data.length < RECONCILE_PAGE_SIZE) return result;
    afterId = data[data.length - 1].id;
  }
}
