import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPatient } from "@/lib/db/patients";
import { getActiveConsent } from "@/lib/db/consents";
import { listConsultationsForPatient } from "@/lib/db/consultations";
import { listReportsForPatient } from "@/lib/db/reports";
import { listSoapNotesForPatient } from "@/lib/db/soap-notes";
import { listAssessmentsForPatient } from "@/lib/db/assessments";
import { getActivePlanForPatient } from "@/lib/db/treatment-plans";
import { renderPatientRecordPdf } from "@/lib/pdf/patient-record-pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) return new Response("No encontrado", { status: 404 });
  // Defensa en profundidad: además de RLS, exige que el paciente pertenezca a
  // la clínica del usuario. Bloquea la descarga del expediente cross-tenant
  // (incl. platform admins, cuyo RLS extendido no debe alcanzar PHI en PDF).
  if (patient.clinicId !== user.clinicId) {
    return new Response("No encontrado", { status: 404 });
  }

  const [consent, consultations, reports, soapNotes, assessments, treatmentPlan] = await Promise.all([
    getActiveConsent(id),
    listConsultationsForPatient(id),
    listReportsForPatient(id),
    listSoapNotesForPatient(id),
    listAssessmentsForPatient(id),
    getActivePlanForPatient(id),
  ]);

  const reportsByConsultation = new Map(reports.map((r) => [r.consultationId, r]));

  const buffer = await renderPatientRecordPdf({
    patient,
    clinicName: user.clinicName,
    consent,
    consultations,
    reportsByConsultation,
    soapNotesByConsultation: soapNotes,
    assessments,
    treatmentPlan,
    generatedAt: new Date().toLocaleString("es-CO"),
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="expediente-${patient.fullName.replace(/\s+/g, "-").toLowerCase()}.pdf"`,
    },
  });
}
