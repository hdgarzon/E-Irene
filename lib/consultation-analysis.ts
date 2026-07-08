import {
  getConsultation,
  getTranscript,
  markConsultationAnalyzed,
  setAnalysisStatus,
} from "@/lib/db/consultations";
import { createReport, getReportByConsultation } from "@/lib/db/reports";
import { getPatient } from "@/lib/db/patients";
import { recordNotification } from "@/lib/db/notifications";
import { getAnalysisProvider } from "@/lib/providers";
import { getEmailProvider } from "@/lib/email/providers";
import { buildReportReadyEmail } from "@/lib/email/templates";
import { logAudit } from "@/lib/db/audit";
import { logger } from "@/lib/logger";

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

    const payload = await getAnalysisProvider().analyze(transcript);
    const report = await createReport(clinicId, {
      consultationId,
      patientId: consultation.patientId,
      payload,
    });
    await markConsultationAnalyzed(consultationId);
    await setAnalysisStatus(consultationId, "done");
    await logAudit({
      clinicId,
      actorId,
      action: "report.generated",
      entityType: "report",
      entityId: report.id,
      metadata: { consultationId },
    });

    // Aviso "reporte listo" al paciente (sin contenido clínico). Un fallo de
    // envío no debe marcar el análisis como fallido: el reporte ya existe.
    const patient = await getPatient(consultation.patientId);
    if (patient?.email) {
      try {
        await getEmailProvider().send(
          buildReportReadyEmail({
            to: patient.email,
            patientName: patient.fullName,
            clinicName,
          }),
        );
        await recordNotification(clinicId, {
          patientId: consultation.patientId,
          type: "report_ready",
          status: "sent",
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
