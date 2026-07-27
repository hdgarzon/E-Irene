import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import type { RiskAlertCategory } from "@/lib/risk-flags";

export interface RiskAlert {
  id: string;
  consultationId: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  date: string;
  categories: RiskAlertCategory[];
}

/**
 * Registra la alerta de riesgo del doctor tratante de la consulta. Debe
 * llamarse ANTES de crear el reporte de sesión (ver `lib/consultation-analysis.ts`):
 * un fallo posterior en la generación del reporte no debe dejar una alerta de
 * riesgo sin persistir.
 *
 * Idempotente por consulta: si el análisis se reintenta tras un fallo (p. ej.
 * `createReport` lanzó una excepción), la restricción `unique(consultation_id)`
 * hace que la segunda llamada sea un no-op — `isNew: false` le indica al
 * llamador que NO debe reenviar el correo al doctor.
 */
export async function createRiskAlert(
  clinicId: string,
  input: {
    consultationId: string;
    patientId: string;
    doctorId: string;
    categories: RiskAlertCategory[];
  },
): Promise<{ id: string; isNew: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("risk_alerts")
    .insert({
      clinic_id: clinicId,
      consultation_id: input.consultationId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      categories_enc: encrypt(JSON.stringify(input.categories)),
    })
    .select("id")
    .single();

  if (!error) return { id: data.id, isNew: true };

  // 23505 = unique_violation (Postgres) → ya existe una alerta para esta
  // consulta. No es un error real, es el camino esperado de un reintento.
  if (error.code === "23505") {
    const existing = await supabase
      .from("risk_alerts")
      .select("id")
      .eq("consultation_id", input.consultationId)
      .single();
    if (existing.error) throw existing.error;
    return { id: existing.data.id, isNew: false };
  }
  throw error;
}

interface RiskAlertRow {
  id: string;
  consultation_id: string;
  patient_id: string;
  doctor_id: string;
  categories_enc: string;
  created_at: string;
  patients: { full_name_enc: string } | null;
  consultations: { started_at: string } | null;
}

/**
 * Alertas de riesgo abiertas (sin acuse de recibo) de la clínica del usuario,
 * más recientes primero. Apoyo a la detección temprana — NUNCA un
 * diagnóstico. Si una fila no descifra (p. ej. tras rotar ENCRYPTION_KEY sin
 * migrar datos antiguos), se omite en vez de romper toda la lista.
 */
export async function listOpenRiskAlerts(limit = 50): Promise<RiskAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("risk_alerts")
    .select(
      "id, consultation_id, patient_id, doctor_id, categories_enc, created_at, " +
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
      consultationId: r.consultation_id,
      patientId: r.patient_id,
      doctorId: r.doctor_id,
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
