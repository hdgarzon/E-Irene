import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { reportSchema, type ReportPayload, type RiskLevel } from "@/lib/providers/types";

export interface Report {
  id: string;
  consultationId: string;
  patientId: string;
  payload: ReportPayload;
  doctorEdited: boolean;
  doctorNotes: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  pdfPath: string | null;
  createdAt: string;
}

interface ReportRow {
  id: string;
  consultation_id: string;
  patient_id: string;
  payload_enc: string;
  doctor_edited: boolean;
  doctor_notes_enc: string | null;
  validated_at: string | null;
  validated_by: string | null;
  pdf_path: string | null;
  created_at: string;
}

function mapRow(r: ReportRow): Report {
  return {
    id: r.id,
    consultationId: r.consultation_id,
    patientId: r.patient_id,
    payload: reportSchema.parse(JSON.parse(decrypt(r.payload_enc))),
    doctorEdited: r.doctor_edited,
    doctorNotes: r.doctor_notes_enc ? decrypt(r.doctor_notes_enc) : null,
    validatedAt: r.validated_at,
    validatedBy: r.validated_by,
    pdfPath: r.pdf_path,
    createdAt: r.created_at,
  };
}

const COLS =
  "id, consultation_id, patient_id, payload_enc, doctor_edited, doctor_notes_enc, validated_at, validated_by, pdf_path, created_at";

export async function createReport(
  clinicId: string,
  input: { consultationId: string; patientId: string; payload: ReportPayload },
): Promise<Report> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({
      clinic_id: clinicId,
      consultation_id: input.consultationId,
      patient_id: input.patientId,
      payload_enc: encrypt(JSON.stringify(input.payload)),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return mapRow(data as ReportRow);
}

export async function getReportByConsultation(consultationId: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(COLS)
    .eq("consultation_id", consultationId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as ReportRow) : null;
}

export interface ReportListItem {
  id: string;
  consultationId: string;
  patientId: string;
  patientName: string;
  date: string;
  sentimentLabel: ReportPayload["sentiment"]["label"];
  sentimentScore: number;
  validated: boolean;
}

/**
 * Todos los reportes de la clínica del usuario (RLS scoped), más recientes
 * primero. Si el payload de un reporte no descifra con la clave actual
 * (p. ej. tras rotar ENCRYPTION_KEY sin migrar datos antiguos), se omite en
 * vez de romper toda la lista; se registra en los logs del servidor.
 */
export async function listReports(): Promise<ReportListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(
      "id, consultation_id, patient_id, payload_enc, validated_at, created_at, " +
        "patients!reports_patient_id_fkey(full_name_enc), " +
        "consultations!reports_consultation_id_fkey(started_at)",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data as unknown as {
    id: string;
    consultation_id: string;
    patient_id: string;
    payload_enc: string;
    validated_at: string | null;
    created_at: string;
    patients: { full_name_enc: string } | null;
    consultations: { started_at: string } | null;
  }[];

  const items: ReportListItem[] = [];
  for (const r of rows) {
    let payload: ReportPayload;
    try {
      payload = reportSchema.parse(JSON.parse(decrypt(r.payload_enc)));
    } catch (error) {
      console.error(`[reports] no se pudo descifrar el reporte ${r.id}:`, error);
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
    items.push({
      id: r.id,
      consultationId: r.consultation_id,
      patientId: r.patient_id,
      patientName,
      date: r.consultations?.started_at ?? r.created_at,
      sentimentLabel: payload.sentiment.label,
      sentimentScore: payload.sentiment.score,
      validated: Boolean(r.validated_at),
    });
  }
  return items;
}

export interface PatientSessionReport {
  consultationId: string;
  date: string;
  payload: ReportPayload;
  doctorNotes: string | null;
  validatedAt: string | null;
}

/** Reportes del paciente (descifrados) con la fecha de su consulta, cronológico. */
export async function listReportsForPatient(patientId: string): Promise<PatientSessionReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(
      "consultation_id, payload_enc, doctor_notes_enc, validated_at, created_at, " +
        "consultations!reports_consultation_id_fkey(started_at)",
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (
    data as unknown as {
      consultation_id: string;
      payload_enc: string;
      doctor_notes_enc: string | null;
      validated_at: string | null;
      created_at: string;
      consultations: { started_at: string } | null;
    }[]
  ).map((r) => ({
    consultationId: r.consultation_id,
    date: r.consultations?.started_at ?? r.created_at,
    payload: reportSchema.parse(JSON.parse(decrypt(r.payload_enc))),
    doctorNotes: r.doctor_notes_enc ? decrypt(r.doctor_notes_enc) : null,
    validatedAt: r.validated_at,
  }));
}

export async function getReport(reportId: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("reports").select(COLS).eq("id", reportId).maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as ReportRow) : null;
}

/** El doctor edita la sugerencia preliminar; marca el reporte como editado. */
export async function updateSuggestion(reportId: string, suggestion: string): Promise<void> {
  const supabase = await createClient();
  const current = await getReport(reportId);
  if (!current) throw new Error("Reporte no encontrado");
  const payload: ReportPayload = { ...current.payload, suggestion };
  const { error } = await supabase
    .from("reports")
    .update({ payload_enc: encrypt(JSON.stringify(payload)), doctor_edited: true })
    .eq("id", reportId);
  if (error) throw error;
}

/**
 * Notas privadas del profesional sobre la sesión — texto libre, escrito por
 * el doctor (no generado por IA), parte de la historia clínica. Vacío borra
 * las notas.
 */
export async function updateDoctorNotes(reportId: string, notes: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({ doctor_notes_enc: notes ? encrypt(notes) : null })
    .eq("id", reportId);
  if (error) throw error;
}

/** El doctor valida (firma) el reporte. */
export async function validateReport(reportId: string, userId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({ validated_by: userId, validated_at: new Date().toISOString() })
    .eq("id", reportId);
  if (error) throw error;
}

export async function setReportPdfPath(reportId: string, path: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("reports").update({ pdf_path: path }).eq("id", reportId);
  if (error) throw error;
}

/** Nº de reportes de la clínica aún sin validar (firma del profesional). */
export async function countPendingReports(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("reports")
    .select("*", { count: "exact", head: true })
    .is("validated_at", null);
  if (error) throw error;
  return count ?? 0;
}

export interface RiskAlert {
  consultationId: string;
  patientId: string;
  patientName: string;
  date: string;
  categories: { key: keyof NonNullable<ReportPayload["riskFlags"]>; level: RiskLevel }[];
}

const RISK_ALERT_LEVELS = new Set<RiskLevel>(["moderado", "alto"]);

/**
 * Alertas de riesgo abiertas: reportes recientes cuyo análisis de IA marcó al
 * menos una categoría (ideación suicida, autolesión, consumo, riesgo a
 * terceros) en nivel "moderado" o "alto". Apoyo a la detección temprana para
 * el profesional — NUNCA un diagnóstico. Los reportes previos a esta versión
 * no tienen riskFlags y simplemente no generan alerta.
 */
export async function listRiskAlerts(limit = 50): Promise<RiskAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .select(
      "consultation_id, patient_id, payload_enc, created_at, " +
        "patients!reports_patient_id_fkey(full_name_enc), " +
        "consultations!reports_consultation_id_fkey(started_at)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data as unknown as {
    consultation_id: string;
    patient_id: string;
    payload_enc: string;
    created_at: string;
    patients: { full_name_enc: string } | null;
    consultations: { started_at: string } | null;
  }[];

  const alerts: RiskAlert[] = [];
  for (const r of rows) {
    let payload: ReportPayload;
    try {
      payload = reportSchema.parse(JSON.parse(decrypt(r.payload_enc)));
    } catch {
      continue; // payload ilegible (clave rotada) → se omite, no rompe la lista
    }
    if (!payload.riskFlags) continue;

    const categories = (
      Object.entries(payload.riskFlags) as [
        keyof NonNullable<ReportPayload["riskFlags"]>,
        { level: RiskLevel },
      ][]
    )
      .filter(([, v]) => RISK_ALERT_LEVELS.has(v.level))
      .map(([key, v]) => ({ key, level: v.level }));

    if (categories.length === 0) continue;

    let patientName = "(nombre no disponible)";
    if (r.patients?.full_name_enc) {
      try {
        patientName = decrypt(r.patients.full_name_enc);
      } catch {
        // se mantiene el placeholder
      }
    }

    alerts.push({
      consultationId: r.consultation_id,
      patientId: r.patient_id,
      patientName,
      date: r.consultations?.started_at ?? r.created_at,
      categories,
    });
  }
  return alerts;
}
