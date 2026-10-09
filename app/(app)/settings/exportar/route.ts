import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listPatients } from "@/lib/db/patients";
import { listConsentsForPatient } from "@/lib/db/consents";
import { listConsultationsForPatient } from "@/lib/db/consultations";
import { listReportsForPatient } from "@/lib/db/reports";
import { listSoapNotesForPatient } from "@/lib/db/soap-notes";
import { listAssessmentsForPatient } from "@/lib/db/assessments";
import { getActivePlanForPatient } from "@/lib/db/treatment-plans";
import { logAudit } from "@/lib/db/audit";
import { dayKey } from "@/lib/dates";

// Una clínica con muchos pacientes tarda: cada uno son siete lecturas.
export const maxDuration = 300;

/**
 * Exportación de los datos de la clínica "en formato estructurado y de uso
 * común" (Términos de Vinculación, cláusula séptima, numerales 3 y 5): un JSON
 * con cada paciente y su historia clínica, ya descifrada. Es lo que el
 * Profesional, como Responsable, debe llevarse antes de eliminar su cuenta para
 * cumplir la conservación de 15 años de la Resolución 839 de 2017.
 *
 * Solo el admin de la clínica. Usa las mismas funciones que el expediente en
 * PDF (RLS de la clínica en sesión) y deja constancia en audit_logs: es una
 * salida masiva de datos clínicos.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  if (user.role !== "admin") return new Response("Solo el administrador de la clínica", { status: 403 });

  const supabase = await createClient();
  const [patients, { count: totalPatients }] = await Promise.all([
    listPatients(),
    supabase.from("patients").select("id", { count: "exact", head: true }),
  ]);

  const records = [];
  for (const patient of patients) {
    const [consents, consultations, reports, soapNotes, assessments, treatmentPlan] = await Promise.all([
      listConsentsForPatient(patient.id),
      listConsultationsForPatient(patient.id),
      listReportsForPatient(patient.id),
      listSoapNotesForPatient(patient.id),
      listAssessmentsForPatient(patient.id),
      getActivePlanForPatient(patient.id),
    ]);
    records.push({
      patient,
      // Todas las versiones firmadas, no solo la vigente: son prueba de la
      // autorización y se conservan con la historia clínica.
      consents,
      consultations,
      reports,
      soapNotes: [...soapNotes.values()],
      assessments,
      treatmentPlan,
    });
  }

  const exportedAt = new Date().toISOString();
  const body = {
    format: "e-irene-export",
    formatVersion: 1,
    exportedAt,
    clinic: { id: user.clinicId, name: user.clinicName },
    // Un paciente que no se pudo descifrar no se omite en silencio: se cuenta.
    patientsInClinic: totalPatients ?? patients.length,
    patientsExported: patients.length,
    patients: records,
  };

  await logAudit({
    clinicId: user.clinicId,
    actorId: user.id,
    action: "clinic.data_exported",
    entityType: "clinic",
    entityId: user.clinicId,
    metadata: { patients: patients.length },
  });

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="e-irene-exportacion-${dayKey(exportedAt)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
