import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado app-layer AES-256-GCM para columnas sensibles (PII de pacientes,
 * transcripciones, contenido de reportes). Cumple Ley 1581 (datos sensibles).
 *
 * Formato del payload: base64(iv).base64(authTag).base64(ciphertext)
 * - iv: 12 bytes aleatorios por operación (nunca reutilizado)
 * - authTag: 16 bytes, detecta manipulación (lanza al descifrar si no coincide)
 */

function keyBuffer(b64Key: string): Buffer {
  const key = Buffer.from(b64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe ser de 32 bytes codificados en base64");
  }
  return key;
}

function requireKey(b64Key?: string): string {
  const k = b64Key ?? process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY no está configurada");
  return k;
}

export function encrypt(plain: string, b64Key?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(requireKey(b64Key)), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64"))
    .join(".");
}

export function decrypt(payload: string, b64Key?: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Payload cifrado con formato inválido");
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(requireKey(b64Key)), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Cifra un valor opcional; null/undefined se conservan como null. */
export function encryptNullable(plain: string | null | undefined, b64Key?: string): string | null {
  return plain == null ? null : encrypt(plain, b64Key);
}

/** Descifra un valor opcional; null/undefined se conservan como null. */
export function decryptNullable(payload: string | null | undefined, b64Key?: string): string | null {
  return payload == null ? null : decrypt(payload, b64Key);
}
