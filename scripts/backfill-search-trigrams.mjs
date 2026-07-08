/**
 * Backfill único: calcula `search_trigrams` para pacientes creados ANTES de
 * la migración 0018 (blind index de búsqueda). Necesario porque el trigrama
 * se deriva de datos descifrados en Node — no se puede hacer en SQL puro.
 *
 * Duplica (no importa) la lógica de cifrado/trigramas de lib/crypto.ts y
 * lib/search-index.ts porque los scripts de este directorio son .mjs
 * autocontenidos, sin bundler ni transpilación de TS (mismo patrón que los
 * demás scripts/*.mjs del repo).
 *
 * Uso: node scripts/backfill-search-trigrams.mjs
 * Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * ENCRYPTION_KEY (deben ser los mismos valores que usa la app en ese entorno).
 */
import { readFileSync } from "node:fs";
import { createDecipheriv, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const envVar = (name) => env.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1];

const SUPABASE_URL = envVar("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = envVar("SUPABASE_SERVICE_ROLE_KEY");
const ENCRYPTION_KEY = envVar("ENCRYPTION_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ENCRYPTION_KEY) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o ENCRYPTION_KEY en .env.local");
  process.exit(1);
}

// --- lib/crypto.ts (decrypt) ---
function decrypt(payload) {
  const [iv, tag, ciphertext] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_KEY, "base64"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// --- lib/text-normalize.ts ---
function normalizeSearchText(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// --- lib/search-index.ts ---
const HMAC_CONTEXT = "e-irene-search-index-v1";
const searchKey = createHmac("sha256", Buffer.from(ENCRYPTION_KEY, "base64"))
  .update(HMAC_CONTEXT)
  .digest();

function computeTrigrams(text) {
  const normalized = normalizeSearchText(text).replace(/\s+/g, " ").trim();
  if (normalized.length < 3) return [];
  const trigrams = new Set();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(createHmac("sha256", searchKey).update(normalized.slice(i, i + 3)).digest("hex"));
  }
  return [...trigrams];
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const { data: patients, error } = await admin
  .from("patients")
  .select("id, full_name_enc, document_enc, phone_enc, search_trigrams")
  .eq("search_trigrams", "{}");
if (error) throw error;

console.log(`Pacientes sin trigramas: ${patients.length}`);

let updated = 0;
let skipped = 0;
for (const p of patients) {
  let fullName, document, phone;
  try {
    fullName = decrypt(p.full_name_enc);
    document = p.document_enc ? decrypt(p.document_enc) : "";
    phone = p.phone_enc ? decrypt(p.phone_enc) : "";
  } catch (err) {
    console.warn(`  ⚠ paciente ${p.id}: no se pudo descifrar (${err.message}), se omite`);
    skipped++;
    continue;
  }
  const trigrams = computeTrigrams(`${fullName} ${document} ${phone}`);
  const { error: updateErr } = await admin
    .from("patients")
    .update({ search_trigrams: trigrams })
    .eq("id", p.id);
  if (updateErr) throw updateErr;
  updated++;
}

console.log(`Listo: ${updated} actualizados, ${skipped} omitidos (no descifrables).`);
