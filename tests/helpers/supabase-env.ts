/**
 * Guarda de entorno para las pruebas que escriben en Supabase con service-role.
 *
 * POR QUÉ EXISTE
 *   Estas pruebas crean cuentas, clínicas y pacientes, y algunas ejecutan
 *   funciones destructivas: retention.test.ts invoca purge_expired_transcripts(),
 *   que contra producción borraría transcripciones reales de pacientes.
 *
 *   Hasta ahora la única condición era que las variables estuvieran definidas:
 *
 *       const d = URL && SERVICE ? describe : describe.skip;
 *
 *   Eso comprueba que exista una URL, no que apunte a un stack local. Con un
 *   .env.local apuntando a producción, `npm test` escribía en producción.
 *
 *   No es hipotético: en producción quedaron 5 cuentas `@e-irene.test` creadas
 *   entre el 24-jun y el 1-jul-2026 con auth.admin.createUser y credenciales
 *   de producción. Fueron scripts sueltos, no la suite —ningún prefijo de esos
 *   existe en el repo— pero la suite tenía exactamente el mismo agujero.
 *
 * CÓMO SE COMPORTA
 *   · Sin variables            → las pruebas se saltan (CI sin stack levantado).
 *   · Variables locales        → las pruebas corren.
 *   · Variables NO locales     → LANZA, deteniendo la corrida entera.
 *
 *   Lanzar y no saltar es deliberado: un `describe.skip` silencioso ante una
 *   URL remota escondería justo la condición peligrosa, y alguien podría
 *   creer que sus pruebas pasaron cuando en realidad no corrieron.
 */

/** Hosts que se consideran un stack de desarrollo. */
const HOST_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?\/?$/i;

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isLocalSupabase(url: string | undefined): boolean {
  return Boolean(url && HOST_LOCAL.test(url.trim()));
}

/**
 * Corta la corrida si hay credenciales apuntando fuera de un stack local.
 * Se ejecuta al importar este módulo: cualquier archivo de prueba que lo use
 * queda protegido sin tener que acordarse de llamar nada.
 */
function assertSupabaseLocal(): void {
  if (!SUPABASE_URL) return; // sin stack: las pruebas se saltan más abajo.
  if (isLocalSupabase(SUPABASE_URL)) return;

  throw new Error(
    `Estas pruebas escriben en Supabase con service-role y solo pueden correr ` +
      `contra un stack local. NEXT_PUBLIC_SUPABASE_URL apunta a "${SUPABASE_URL}".\n` +
      `Si es producción, correrlas crearía cuentas reales y purgaría datos ` +
      `clínicos. Levantá el stack local ("supabase start") y apuntá .env.local ` +
      `a él antes de reintentar.`,
  );
}

assertSupabaseLocal();

/** true cuando hay un stack local utilizable con service-role. */
export const hasLocalSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
