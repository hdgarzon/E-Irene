import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado app-layer AES-256-GCM para columnas sensibles (PII de pacientes,
 * transcripciones, contenido de reportes). Cumple Ley 1581 (datos sensibles).
 *
 * Formato del payload: [k<id>:]base64(iv).base64(authTag).base64(ciphertext)
 * - iv: 12 bytes aleatorios por operación (nunca reutilizado)
 * - authTag: 16 bytes, detecta manipulación (lanza al descifrar si no coincide)
 * - k<id>: con qué clave se cifró. Sin prefijo = clave 1, la original: todo lo
 *   cifrado antes de existir la rotación sigue leyéndose igual.
 *
 * Llavero (variables de entorno):
 * - ENCRYPTION_KEY / ENCRYPTION_KEY_ID: la clave en uso y su id (por defecto "1").
 * - ENCRYPTION_KEY_NEXT / ENCRYPTION_KEY_NEXT_ID: solo durante una rotación. La
 *   nueva pasa a ser la activa (cifra todo lo nuevo) y ENCRYPTION_KEY queda como
 *   retirada, solo para descifrar. Así la rotación no exige volver a escribir la
 *   clave vieja, que en Vercel es Sensitive y no se puede leer.
 * - ENCRYPTION_KEYS_RETIRED: otras claves para descifrar, "id:base64,id:base64".
 * Procedimiento: docs/rotacion-clave-cifrado.md.
 */

const PREFIX = /^k(\d+):/;
const LEGACY_KEY_ID = "1";

function keyBuffer(b64Key: string): Buffer {
  const key = Buffer.from(b64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY debe ser de 32 bytes codificados en base64");
  }
  return key;
}

interface Keyring {
  activeId: string;
  keys: Map<string, string>;
}

function validId(id: string, variable: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`${variable} debe ser un número`);
  return id;
}

/** Lee y valida el llavero del entorno. Lanza si algo está mal configurado. */
function loadKeyring(): Keyring {
  const current = process.env.ENCRYPTION_KEY;
  if (!current) throw new Error("ENCRYPTION_KEY no está configurada");
  keyBuffer(current);
  const currentId = validId(
    (process.env.ENCRYPTION_KEY_ID ?? LEGACY_KEY_ID).trim() || LEGACY_KEY_ID,
    "ENCRYPTION_KEY_ID",
  );
  const keys = new Map<string, string>([[currentId, current]]);
  let activeId = currentId;

  const next = process.env.ENCRYPTION_KEY_NEXT?.trim();
  if (next) {
    const nextId = validId((process.env.ENCRYPTION_KEY_NEXT_ID ?? "").trim(), "ENCRYPTION_KEY_NEXT_ID");
    if (nextId === currentId) throw new Error("ENCRYPTION_KEY_NEXT_ID debe ser distinto de ENCRYPTION_KEY_ID");
    keyBuffer(next);
    keys.set(nextId, next);
    activeId = nextId;
  }

  for (const entry of (process.env.ENCRYPTION_KEYS_RETIRED ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    const id = trimmed.slice(0, sep).trim();
    const key = trimmed.slice(sep + 1).trim();
    if (sep < 1 || !/^\d+$/.test(id)) {
      throw new Error("ENCRYPTION_KEYS_RETIRED debe tener la forma id:clave,id:clave");
    }
    if (keys.has(id)) throw new Error(`La clave ${id} aparece dos veces en el llavero`);
    keyBuffer(key);
    keys.set(id, key);
  }
  return { activeId, keys };
}

function splitPayload(payload: string): { keyId: string; body: string } {
  const match = PREFIX.exec(payload);
  return match
    ? { keyId: match[1], body: payload.slice(match[0].length) }
    : { keyId: LEGACY_KEY_ID, body: payload };
}

function encryptWith(plain: string, b64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuffer(b64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64"))
    .join(".");
}

function decryptWith(body: string, b64Key: string): string {
  const parts = body.split(".");
  if (parts.length !== 3) throw new Error("Payload cifrado con formato inválido");
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", keyBuffer(b64Key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Lanza si la clave no está configurada o no mide 32 bytes (o, sin clave
 * explícita, si el llavero está mal formado). Para quien descifra muchos valores
 * y tiene que distinguir un dato ilegible (falla ese valor) de una clave ausente
 * (fallan todos: es configuración y tiene que fallar entero).
 */
export function assertEncryptionKey(b64Key?: string): void {
  if (b64Key !== undefined) keyBuffer(b64Key);
  else loadKeyring();
}

/** Id de la clave activa, con la que se cifra todo lo nuevo. */
export function activeKeyId(): string {
  return loadKeyring().activeId;
}

/**
 * Clave activa (base64). Solo para derivar otras claves, como la del índice de
 * búsqueda (lib/search-index.ts): nunca se expone ni se registra.
 */
export function activeKeyMaterial(): string {
  const { activeId, keys } = loadKeyring();
  return keys.get(activeId)!;
}

/** Id de la clave con que se cifró un valor. */
export function keyIdOf(payload: string): string {
  return splitPayload(payload).keyId;
}

/**
 * Cifra con la clave activa. Con una clave explícita (pruebas, scripts) usa esa
 * y el formato sin prefijo.
 */
export function encrypt(plain: string, b64Key?: string): string {
  if (b64Key !== undefined) return encryptWith(plain, b64Key);
  const { activeId, keys } = loadKeyring();
  const body = encryptWith(plain, keys.get(activeId)!);
  return activeId === LEGACY_KEY_ID ? body : `k${activeId}:${body}`;
}

/**
 * Descifra con la clave que indica el prefijo del valor (sin prefijo, la 1),
 * buscándola en el llavero. Con una clave explícita usa esa.
 */
export function decrypt(payload: string, b64Key?: string): string {
  const { keyId, body } = splitPayload(payload);
  if (b64Key !== undefined) return decryptWith(body, b64Key);
  const key = loadKeyring().keys.get(keyId);
  if (!key) {
    throw new Error(`La clave de cifrado ${keyId} no está en el llavero`);
  }
  return decryptWith(body, key);
}

/** Cifra un valor opcional; null/undefined se conservan como null. */
export function encryptNullable(plain: string | null | undefined, b64Key?: string): string | null {
  return plain == null ? null : encrypt(plain, b64Key);
}

/** Descifra un valor opcional; null/undefined se conservan como null. */
export function decryptNullable(payload: string | null | undefined, b64Key?: string): string | null {
  return payload == null ? null : decrypt(payload, b64Key);
}
