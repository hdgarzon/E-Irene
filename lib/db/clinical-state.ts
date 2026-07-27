import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  clinicalStateSchema,
  mergeClinicalState,
  EMPTY_CLINICAL_STATE,
  type ClinicalState,
  type ClinicalStateDelta,
} from "@/lib/clinical-state";
import type { AnalysisProvenance } from "@/lib/providers/types";

interface StateRow {
  version: number;
  state_enc: string;
}

function decodeState(stateEnc: string, patientId: string): ClinicalState {
  try {
    return clinicalStateSchema.parse(JSON.parse(decrypt(stateEnc)));
  } catch (error) {
    // Estado ilegible (p. ej. clave rotada) → se parte de vacío en vez de
    // romper el análisis de la sesión actual. Se pierde continuidad, no
    // disponibilidad — igual que el resto del código que descifra reportes.
    logger.warn("clinical_state.decrypt_or_parse_failed", { patientId, error });
    return EMPTY_CLINICAL_STATE;
  }
}

/**
 * Último estado clínico persistido del paciente, o el estado vacío si es su
 * primera sesión. Es el contexto de entrada del análisis (`AnalysisContext.previousState`)
 * — nunca se le pasa al proveedor el historial completo de versiones, solo
 * la más reciente ya acumulada (costo O(1), no O(n) en número de sesiones).
 */
export async function getLatestClinicalState(patientId: string): Promise<ClinicalState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patient_clinical_state")
    .select("version, state_enc")
    .eq("patient_id", patientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? decodeState(data.state_enc, patientId) : EMPTY_CLINICAL_STATE;
}

export interface ClinicalStateSnapshot {
  state: ClinicalState;
  /**
   * Consulta que originó esta versión — con ella se calcula "qué cambió"
   * (ver `whatsNewInSession` en lib/clinical-state.ts). `null` solo si esa
   * consulta fue borrada después (`consultation_id` es `ON DELETE SET
   * NULL`): el estado sigue siendo válido, pero ya no se puede saber qué se
   * tocó en esa sesión específica.
   */
  consultationId: string | null;
  version: number;
  createdAt: string;
}

/**
 * Último estado clínico del paciente CON su procedencia — a diferencia de
 * `getLatestClinicalState` (que solo da el estado, para alimentar el
 * siguiente análisis), esto es para el Brief Pre-Sesión: necesita saber
 * QUÉ consulta generó la versión más reciente para poder separar "lo nuevo
 * de la última sesión" del resto del acumulado. `null` si el paciente aún
 * no tiene ninguna sesión analizada.
 */
export async function getLatestClinicalStateSnapshot(
  patientId: string,
): Promise<ClinicalStateSnapshot | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("patient_clinical_state")
    .select("version, state_enc, consultation_id, created_at")
    .eq("patient_id", patientId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    state: decodeState(data.state_enc, patientId),
    consultationId: data.consultation_id,
    version: data.version,
    createdAt: data.created_at,
  };
}

/**
 * Fusiona `delta` sobre el último estado del paciente y persiste la nueva
 * versión — append-only (nunca UPDATE), ver spec §2.
 *
 * Idempotente por consulta: si el análisis se reintenta (p. ej. un fallo
 * posterior en `createReport`), releer y volver a fusionar el MISMO delta
 * sobre un estado que ya lo incluye duplicaría las observaciones. Por eso,
 * al inicio de cada intento, se comprueba si esta `consultationId` ya
 * generó una versión (`unique(consultation_id)` en la migración) y, de ser
 * así, se devuelve esa versión sin volver a fusionar.
 *
 * Reintenta hasta 2 veces ante una colisión (23505): dos análisis del mismo
 * paciente terminando en el mismo instante es infrecuente pero posible (dos
 * consultas concurrentes), y también cubre el caso de que otra ejecución ya
 * haya insertado la fila de esta consulta mientras calculábamos la nuestra.
 */
export async function appendClinicalState(
  clinicId: string,
  input: {
    patientId: string;
    consultationId: string;
    delta: ClinicalStateDelta;
    provenance: AnalysisProvenance;
  },
): Promise<ClinicalState> {
  const supabase = await createClient();

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await supabase
      .from("patient_clinical_state")
      .select("state_enc")
      .eq("consultation_id", input.consultationId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return decodeState(existing.data.state_enc, input.patientId);

    const { data: latestRow, error: latestError } = await supabase
      .from("patient_clinical_state")
      .select("version, state_enc")
      .eq("patient_id", input.patientId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;

    const previousState = latestRow
      ? decodeState((latestRow as StateRow).state_enc, input.patientId)
      : EMPTY_CLINICAL_STATE;
    const nextVersion = (latestRow?.version ?? 0) + 1;
    const nextState = mergeClinicalState(previousState, input.delta, input.consultationId);

    const { error: insertError } = await supabase.from("patient_clinical_state").insert({
      clinic_id: clinicId,
      patient_id: input.patientId,
      consultation_id: input.consultationId,
      version: nextVersion,
      state_enc: encrypt(JSON.stringify(nextState)),
      model: input.provenance.model,
      prompt_version: input.provenance.promptVersion,
    });
    if (!insertError) return nextState;
    // 23505 puede venir de unique(patient_id, version) [carrera entre dos
    // análisis del mismo paciente] o de unique(consultation_id) [alguien más
    // ya insertó para esta consulta mientras calculábamos]. En ambos casos,
    // el siguiente intento vuelve a comprobar `existing` y relee la versión
    // más reciente — es la forma correcta de resolver cualquiera de los dos.
    if (insertError.code !== "23505" || attempt === 1) throw insertError;
  }
  throw new Error("No se pudo persistir el estado clínico tras reintentar.");
}
