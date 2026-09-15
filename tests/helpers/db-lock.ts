import postgres from "postgres";

/**
 * Candado sobre un barrido global del Supabase local: entre corridas de la suite
 * que comparten el stack y entre archivos de una misma corrida.
 *
 * POR QUÉ EXISTE
 *   Algunas pruebas ejercen funciones GLOBALES. verification-grandfather.test.ts
 *   llama a expire_grandfathered_verifications con un plazo ya vencido, y ese
 *   barrido degrada TODAS las cuentas heredadas sin documentos de la base, no
 *   solo las que creó la prueba.
 *
 *   Con varias sesiones sobre un mismo stack local, el barrido de una corrida
 *   alcanzaba las cuentas que otra acababa de crear, antes de que esa llegara a
 *   submitLegacyDocuments. Fallaban casos distintos en cada corrida con "La
 *   cuenta no es una verificación heredada pendiente de documentos"
 *   (14-sep-2026), y minutos después pasaba todo. En CI no se ve: la base es
 *   nueva en cada job y corre una sola suite.
 *
 *   Dentro de una misma corrida pasa lo mismo entre archivos, porque vitest los
 *   corre en paralelo, y eso sí alcanza a CI: ver SUBSCRIPTION_SWEEPS_LOCK.
 *
 *   Acotar el barrido a lo que creó cada prueba exigiría un parámetro solo para
 *   pruebas en la función de producción. En cambio, se turnan.
 *
 * CÓMO SE COMPORTA
 *   · Advisory lock de sesión de Postgres, en una conexión directa y propia. Si
 *     el proceso muere, la conexión se cierra y el candado se libera solo: no
 *     quedan candados huérfanos que haya que limpiar.
 *   · Cada llamada abre su propia sesión: dos archivos de una misma corrida se
 *     turnan igual que dos corridas.
 *   · Espera hasta LOCK_WAIT_MS a que lo suelte quien lo tiene. Pasado ese
 *     tiempo lanza, en vez de colgar la suite sin decir por qué.
 *   · Solo se toma contra una base local, igual que supabase-env.ts.
 *
 *   Solo turna a las corridas que piden el mismo candado: una rama anterior a
 *   este cambio sigue barriendo sin pedirlo.
 */

/**
 * Base del stack local: el puerto [db] de supabase/config.toml y la clave fija
 * que imprime `supabase status`. No es un secreto; solo existe en el contenedor
 * local. SUPABASE_DB_URL la reemplaza si el stack usa otros puertos.
 */
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "[::1]"]);

/** Cuánto se espera a quien tiene el candado. Cada archivo que lo pide tarda unos 10 s. */
export const LOCK_WAIT_MS = 120_000;

/**
 * Los barridos de suscripciones, end_canceled_subscriptions (0041) y
 * end_overdue_subscriptions (0042), terminan TODAS las clínicas que cumplen su
 * condición. billing-cycle.test.ts y billing-grace.test.ts piden este candado
 * porque cada uno siembra clínicas que alcanza el barrido del otro:
 *   · la cancelada con el período vencido que siembra billing-grace, para afirmar
 *     que end_overdue_subscriptions no la toca, la termina el
 *     end_canceled_subscriptions de billing-cycle;
 *   · la clínica que billing-cycle deja vencida hace 10 días antes de renovarla
 *     la termina el end_overdue_subscriptions de billing-grace.
 * Forzando ese orden fallaban las dos pruebas (15-sep-2026). Lo primero no se
 * evita sembrando otro estado: una cancelada vencida hace más que la gracia
 * también está al alcance de su propio barrido.
 */
export const SUBSCRIPTION_SWEEPS_LOCK = "end_canceled_subscriptions/end_overdue_subscriptions";

/**
 * Espera el turno sobre `resource` y devuelve la función que lo libera.
 *
 * @param resource  lo compartido que se protege (p. ej. el nombre de la función
 *                  global). Todas las pruebas que dependan de él piden el mismo.
 */
export async function lockAcrossRuns(resource: string): Promise<() => Promise<void>> {
  const url = process.env.SUPABASE_DB_URL || LOCAL_DB_URL;
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `El candado entre corridas solo se toma contra la base local; SUPABASE_DB_URL apunta a "${host}".`,
    );
  }

  // Una sola conexión: el candado de sesión vive en ella.
  const sql = postgres(url, { max: 1 });
  try {
    await sql`select set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, false)`;
    await sql`select pg_advisory_lock(hashtext(${resource}))`;
  } catch (error) {
    await sql.end({ timeout: 1 });
    if ((error as { code?: string }).code === "55P03") {
      throw new Error(
        `Otra corrida lleva más de ${LOCK_WAIT_MS / 1000} s con "${resource}" en la base local. ` +
          `Si quedó colgada, detenla: al cerrarse su conexión se libera el candado.`,
      );
    }
    throw error;
  }

  // Cerrar la conexión libera el candado.
  return () => sql.end({ timeout: 5 });
}
