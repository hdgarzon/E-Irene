import { readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Candado de máquina sobre el Supabase local: una sola corrida de pruebas a la vez.
 *
 * POR QUÉ EXISTE
 *   Todos los worktrees de una máquina usan el mismo stack local (puerto 54321),
 *   y varias sesiones corren `vitest run` o Playwright a la vez. El 14 y 15 de
 *   septiembre de 2026 eso rompió pruebas que estaban bien, por dos vías:
 *
 *   · Barridos globales. expire_grandfathered_verifications() degrada TODAS las
 *     cuentas heredadas de la base: el de una suite degradaba la cuenta que otra
 *     acababa de crear, y submitLegacyDocuments lanzaba "La cuenta no es una
 *     verificación heredada pendiente de documentos". end_overdue_subscriptions(),
 *     end_canceled_subscriptions() y purge_expired_transcripts() también actúan
 *     sobre toda la base.
 *   · Saturación. Con dos o tres suites en paralelo, Postgres pasó el 200% de CPU
 *     y GoTrue respondió 504 en /signup y /admin/users: AuthRetryableFetchError,
 *     timeouts y fallas en cascada en el resto del describe.
 *
 *   En CI no pasa: cada corrida tiene su propio stack.
 *
 *   db-lock.ts es anterior y más acotado: un advisory lock de Postgres que turna
 *   solo verification-grandfather.test.ts. Este turna la corrida entera (todos
 *   los barridos, la carga sobre GoTrue y Playwright); aquel sigue cubriendo a
 *   las ramas que todavía no tienen este.
 *
 * CÓMO SE COMPORTA
 *   · Libre                    → se toma: un archivo en os.tmpdir() creado con el
 *                                flag "wx", que falla de forma atómica si ya
 *                                existe. Guarda pid, cwd y hora de inicio.
 *   · Ocupado por otra corrida → se espera, avisando qué worktree lo tiene, hasta
 *                                LOCK_TIMEOUT_MS; después LANZA sin haber corrido
 *                                ninguna prueba.
 *   · Su pid ya no existe      → está vencido (una corrida matada no llega a
 *                                soltarlo) y se reemplaza.
 *
 *   os.tmpdir() es el temporal del usuario (/var/folders/… en macOS), el mismo
 *   para todas sus sesiones y terminales. Una sesión con TMPDIR propio no vería
 *   el candado de las demás.
 */

/** Tope de espera: una corrida E2E (≈4 min en CI, más en local) y una unitaria en cola. */
export const LOCK_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1_000;
const NOTICE_EVERY_MS = 30_000;
/**
 * "wx" crea el archivo y recién después escribe: en ese instante otra corrida
 * puede leerlo vacío. Solo un candado ilegible más viejo que esto se da por
 * abandonado.
 */
const PARTIAL_WRITE_GRACE_MS = 5_000;

export interface LockHolder {
  pid: number;
  cwd: string;
  startedAt: string;
}

export interface SupabaseLock {
  path: string;
  /** true si otra corrida lo tenía y hubo que esperar. */
  waited: boolean;
  release: () => void;
}

export interface AcquireOptions {
  timeoutMs?: number;
  pollMs?: number;
  noticeEveryMs?: number;
  log?: (message: string) => void;
  // Inyectables para probar el candado sin stack, sin procesos reales y sin esperar.
  dir?: string;
  pid?: number;
  cwd?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  isAlive?: (pid: number) => boolean;
}

/**
 * Ruta del candado del stack que responde en `supabaseUrl`. Va por puerto y no
 * por URL: localhost:54321 y 127.0.0.1:54321 son el mismo stack, y los helpers
 * de e2e usan 127.0.0.1 fijo.
 */
export function supabaseLockPath(supabaseUrl: string, dir: string = tmpdir()): string {
  const url = new URL(supabaseUrl.trim());
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return join(dir, `e-irene-supabase-${port}.lock`);
}

/** Si el proceso existe. EPERM significa que existe pero es de otro usuario. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

/**
 * Toma el candado del stack, esperando si otra corrida lo tiene. Lanza pasado el
 * tope, con quién lo tiene y cómo borrarlo si quedó colgado.
 */
export async function acquireSupabaseLock(
  supabaseUrl: string,
  options: AcquireOptions = {},
): Promise<SupabaseLock> {
  const {
    timeoutMs = LOCK_TIMEOUT_MS,
    pollMs = POLL_MS,
    noticeEveryMs = NOTICE_EVERY_MS,
    log = (message: string) => console.warn(message),
    dir = tmpdir(),
    pid = process.pid,
    cwd = process.cwd(),
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    isAlive = isProcessAlive,
  } = options;

  const path = supabaseLockPath(supabaseUrl, dir);
  const release = () => releaseSupabaseLock(path, pid);
  const deadline = now() + timeoutMs;
  let waited = false;
  let lastHolder = "";
  let lastNoticeAt = -Infinity;

  for (;;) {
    const me: LockHolder = { pid, cwd, startedAt: new Date(now()).toISOString() };
    const attempt = tryAcquire(path, me, isAlive, now);
    if (attempt.acquired) return { path, waited, release };

    const holder = describeHolder(attempt.holder);
    const t = now();
    if (t >= deadline) {
      throw new Error(
        `El Supabase local (${supabaseUrl}) sigue ocupado por otra corrida tras ` +
          `${formatDuration(timeoutMs)} de espera: ${holder}.\n` +
          `Dos corridas a la vez sobre la misma base se rompen entre sí (los barridos globales, ` +
          `como expire_grandfathered_verifications, alcanzan los datos de la otra) y saturan GoTrue.\n` +
          `Si ese pid ya no es una corrida de pruebas (el sistema lo reutilizó), borra el candado: rm "${path}"\n` +
          `No se corrió ninguna prueba.`,
      );
    }
    if (holder !== lastHolder || t - lastNoticeAt >= noticeEveryMs) {
      log(
        `El Supabase local (${supabaseUrl}) lo está usando otra corrida: ${holder}. ` +
          `Esperando a que termine, como mucho hasta ${new Date(deadline).toISOString()}.`,
      );
      lastHolder = holder;
      lastNoticeAt = t;
    }
    waited = true;
    await sleep(Math.min(pollMs, deadline - t));
  }
}

/** Suelta el candado si lo tiene `pid`. Si no existe o es de otra corrida, no hace nada. */
export function releaseSupabaseLock(path: string, pid: number = process.pid): void {
  if (readLock(path)?.holder?.pid !== pid) return;
  removeLock(path);
}

type Attempt = { acquired: true } | { acquired: false; holder: LockHolder | null };

function tryAcquire(
  path: string,
  me: LockHolder,
  isAlive: (pid: number) => boolean,
  now: () => number,
): Attempt {
  let holder: LockHolder | null = null;
  // El segundo intento es para después de borrar un candado vencido, o de que la
  // otra corrida lo soltara entre crearlo y leerlo.
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(path, JSON.stringify(me), { flag: "wx" });
      return { acquired: true };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const current = readLock(path);
    if (!current) continue;
    holder = current.holder;
    // Una re-ejecución en modo watch que no llegó a soltarlo: no se espera a sí misma.
    if (holder?.pid === me.pid) return { acquired: true };
    if (!isAbandoned(path, holder, isAlive, now)) return { acquired: false, holder };
    removeIfUnchanged(path, current.raw);
  }
  return { acquired: false, holder };
}

function isAbandoned(
  path: string,
  holder: LockHolder | null,
  isAlive: (pid: number) => boolean,
  now: () => number,
): boolean {
  if (holder) return !isAlive(holder.pid);
  // Ilegible: otra corrida lo acaba de crear y todavía no escribió, o murió justo ahí.
  try {
    return now() - statSync(path).mtimeMs > PARTIAL_WRITE_GRACE_MS;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    throw error;
  }
}

/**
 * Borra un candado vencido solo si sigue siendo el que se leyó: si otra corrida
 * lo reemplazó en el medio, se respeta. Entre releer y borrar queda una ventana
 * mínima; en el peor caso dos corridas quedan en paralelo, que es lo que pasaba
 * sin candado, no algo peor.
 */
function removeIfUnchanged(path: string, raw: string): void {
  if (readLock(path)?.raw !== raw) return;
  removeLock(path);
}

function removeLock(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function readLock(path: string): { raw: string; holder: LockHolder | null } | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  return { raw, holder: parseHolder(raw) };
}

function parseHolder(raw: string): LockHolder | null {
  let value: Partial<LockHolder> | null;
  try {
    value = JSON.parse(raw);
  } catch {
    return null; // vacío o a medio escribir
  }
  const { pid, cwd, startedAt } = value ?? {};
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return null;
  if (typeof cwd !== "string" || typeof startedAt !== "string") return null;
  return { pid, cwd, startedAt };
}

function describeHolder(holder: LockHolder | null): string {
  if (!holder) return "recién creado, todavía sin datos de quién lo tiene";
  return `pid ${holder.pid} en ${holder.cwd}, desde ${holder.startedAt}`;
}

function formatDuration(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
