import { createHmac } from "node:crypto";
import { normalizeSearchText } from "@/lib/text-normalize";

/** Mínimo de caracteres para activar la búsqueda por trigramas (ver computeTrigrams). */
export const MIN_QUERY_LENGTH = 3;

const HMAC_CONTEXT = "e-irene-search-index-v1";

/**
 * Deriva la clave del HMAC de trigramas a partir de ENCRYPTION_KEY (misma
 * clave de cifrado, distinto propósito vía HMAC con contexto fijo — evita una
 * env var adicional sin reutilizar la clave AES directamente).
 */
function deriveSearchKey(): Buffer {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("ENCRYPTION_KEY no está configurada");
  return createHmac("sha256", Buffer.from(encryptionKey, "base64")).update(HMAC_CONTEXT).digest();
}

function hmacTrigram(trigram: string, key: Buffer): string {
  return createHmac("sha256", key).update(trigram).digest("hex");
}

/**
 * Trigramas únicos (HMAC-SHA256, hex) del texto normalizado. Cada trigrama
 * cifra un fragmento de 3 caracteres — nunca el valor completo — así que el
 * arreglo resultante sirve como blind index: acota candidatos en BD sin
 * revelar el texto en claro. Textos más cortos que 3 caracteres no producen
 * trigramas (ver MIN_QUERY_LENGTH).
 */
export function computeTrigrams(text: string): string[] {
  const normalized = normalizeSearchText(text).replace(/\s+/g, " ").trim();
  if (normalized.length < MIN_QUERY_LENGTH) return [];
  const key = deriveSearchKey();
  const trigrams = new Set<string>();
  for (let i = 0; i <= normalized.length - MIN_QUERY_LENGTH; i++) {
    trigrams.add(hmacTrigram(normalized.slice(i, i + MIN_QUERY_LENGTH), key));
  }
  return [...trigrams];
}

/** true si la consulta es suficientemente larga para buscar por trigramas. */
export function isSearchableQuery(query: string): boolean {
  return normalizeSearchText(query).trim().length >= MIN_QUERY_LENGTH;
}

/** Texto buscable combinado de un paciente (mismos campos que la búsqueda actual). */
export function patientSearchText(input: {
  fullName: string;
  document?: string | null;
  phone?: string | null;
}): string {
  return `${input.fullName} ${input.document ?? ""} ${input.phone ?? ""}`;
}
