import {
  getConsultation,
  getTranscript,
  markConsultationAnalyzed,
  setAnalysisStatus,
} from "@/lib/db/consultations";
import { createReport, getReportByConsultation } from "@/lib/db/reports";
import { getPatient } from "@/lib/db/patients";
import { getMemberContact } from "@/lib/db/team";
import { createRiskAlert } from "@/lib/db/risk-alerts";
import { getLatestClinicalState, appendClinicalState } from "@/lib/db/clinical-state";
import { getLatestAssessments } from "@/lib/db/assessments";
import { getActivePlanForPatient } from "@/lib/db/treatment-plans";
import { recordNotification, statusForDeliveryMode } from "@/lib/db/notifications";
import { getAnalysisProvider } from "@/lib/providers";
import { getEmailProvider } from "@/lib/email/providers";
import { buildReportReadyEmail, buildRiskAlertEmail } from "@/lib/email/templates";
import { extractRiskAlertCategories, RISK_CATEGORY_LABEL } from "@/lib/risk-flags";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";
import { appBaseUrl } from "@/lib/app-url";

/**
 * Analiza la transcripción de una consulta finalizada y genera el reporte
 * clínico. Se ejecuta en background (vía `after()`, ver
 * app/(app)/consultations/actions.ts) para no bloquear el cierre de la sesión
 * con una llamada lenta al proveedor de IA — el estado queda en
 * `consultations.analysis_status` y la UI hace polling sobre él.
 *
 * Idempotente: si ya existe un reporte para la consulta (p. ej. un reintento
 * tras un fallo posterior al de creación del reporte), no vuelve a analizar.
 */
export async function runConsultationAnalysis(params: {
  consultationId: string;
  clinicId: string;
  actorId: string;
  clinicName: string;
}): Promise<void> {
  const { consultationId, clinicId, actorId, clinicName } = params;
  try {
    const existingReport = await getReportByConsultation(consultationId);
    if (existingReport) {
      await setAnalysisStatus(consultationId, "done");
      return;
    }

    await setAnalysisStatus(consultationId, "processing");

    const [consultation, transcript] = await Promise.all([
      getConsultation(consultationId),
      getTranscript(consultationId),
    ]);
    if (!consultation || !transcript) {
      await setAnalysisStatus(consultationId, "failed", "No hay transcripción para analizar.");
      return;
    }

    // Contexto de continuidad: el modelo ve el estado acumulado del paciente,
    // sus últimas escalas y el enfoque terapéutico del plan vigente (si hay
    // uno) — nunca el historial completo de sesiones (costo O(1), no O(n) en
    // número de sesiones; ver spec §2).
    const [previousState, assessments, activePlan] = await Promise.all([
      getLatestClinicalState(consultation.patientId),
      getLatestAssessments(consultation.patientId),
      getActivePlanForPatient(consultation.patientId),
    ]);
    const { payload, provenance, stateDelta } = await getAnalysisProvider().analyze({
      transcript,
      previousState,
      assessments,
      approach: activePlan?.approach ?? undefined,
    });
    const patient = await getPatient(consultation.patientId);

    // Alerta de riesgo AL DOCTOR TRATANTE — se persiste ANTES de crear el
    // reporte, deliberadamente: si `createReport` falla más abajo, la
    // alerta ya existe y no depende de que el reporte se termine de generar.
    // Canal separado del pipeline de reportes; nunca notifica al paciente.
    const alertCategories = extractRiskAlertCategories(payload.riskFlags);
    if (alertCategories.length > 0) {
      const { isNew } = await createRiskAlert(clinicId, {
        source: "session_analysis",
        consultationId,
        patientId: consultation.patientId,
        doctorId: consultation.doctorId,
        categories: alertCategories,
      });
      // Solo se avisa por correo la primera vez — un reintento del análisis
      // (p. ej. tras un fallo posterior al de esta alerta) no debe reenviar
      // el aviso al doctor.
      if (isNew) {
        // Queda en el audit log si el aviso salió de verdad o si el canal
        // estaba en modo simulado. Es la alerta de ideación suicida: importa
        // poder responder después "¿se le avisó al doctor?" sin adivinar.
        let alertEmailMode: string | null = null;
        try {
          const doctor = await getMemberContact(consultation.doctorId);
          if (doctor?.email) {
            const appUrl = appBaseUrl();
            const email = getEmailProvider();
            alertEmailMode = email.mode;
            await email.send(
              buildRiskAlertEmail({
                to: doctor.email,
                doctorName: doctor.fullName,
                patientName: patient?.fullName ?? "un paciente",
                clinicName,
                consultationUrl: `${appUrl}/consultations/${consultationId}`,
                categories: alertCategories.map((c) => ({
                  label: RISK_CATEGORY_LABEL[c.key],
                  level: c.level,
                })),
              }),
            );
          }
        } catch (error) {
          // El aviso por correo es best-effort: la alerta ya quedó
          // persistida y visible en el dashboard aunque el correo falle.
          logger.warn("risk_alert_email.send_failed", { clinicId, consultationId, error });
        }
        await logAudit({
          clinicId,
          actorId,
          action: "risk_alert.created",
          entityType: "consultation",
          entityId: consultationId,
          metadata: {
            categories: alertCategories.map((c) => `${c.key}:${c.level}`),
            emailMode: alertEmailMode ?? "sin_correo_del_doctor",
          },
        });
      }
    }

    // Actualiza el estado clínico longitudinal del paciente con lo observado
    // en esta sesión (append-only, idempotente por consulta — ver
    // lib/db/clinical-state.ts). Se hace ANTES de crear el reporte por la
    // misma razón que la alerta de riesgo: un fallo posterior en
    // `createReport` no debe dejar la continuidad del paciente sin registrar.
    await appendClinicalState(clinicId, {
      patientId: consultation.patientId,
      consultationId,
      delta: stateDelta,
      provenance,
    });

    const report = await createReport(clinicId, {
      consultationId,
      patientId: consultation.patientId,
      payload,
      provenance,
    });
    await markConsultationAnalyzed(consultationId);
    await setAnalysisStatus(consultationId, "done");
    await logAudit({
      clinicId,
      actorId,
      action: "report.generated",
      entityType: "report",
      entityId: report.id,
      metadata: {
        consultationId,
        model: provenance.model,
        promptVersion: provenance.promptVersion,
      },
    });

    // Aviso "reporte listo" al paciente (sin contenido clínico). Un fallo de
    // envío no debe marcar el análisis como fallido: el reporte ya existe.
    if (patient?.email) {
      try {
        const email = getEmailProvider();
        await email.send(
          buildReportReadyEmail({
            to: patient.email,
            patientName: patient.fullName,
            clinicName,
          }),
        );
        await recordNotification(clinicId, {
          patientId: consultation.patientId,
          type: "report_ready",
          status: statusForDeliveryMode(email.mode),
          payload: { mode: email.mode },
        });
      } catch (error) {
        logger.warn("report_ready_email.send_failed", { clinicId, consultationId, error });
        await recordNotification(clinicId, {
          patientId: consultation.patientId,
          type: "report_ready",
          status: "failed",
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al analizar la consulta.";
    logger.error("consultation.analysis_failed", { clinicId, actorId, consultationId, error });
    await setAnalysisStatus(consultationId, "failed", message).catch(() => {});
    await logAudit({
      clinicId,
      actorId,
      action: "report.generation_failed",
      entityType: "consultation",
      entityId: consultationId,
      metadata: { error: message },
    }).catch(() => {});
  }
}
