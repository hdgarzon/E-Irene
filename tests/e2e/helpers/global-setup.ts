import type { FullConfig } from "@playwright/test";
import { acquireSupabaseLock } from "../../helpers/supabase-lock";

// Guarda de entorno: importar esto aborta la corrida si NEXT_PUBLIC_SUPABASE_URL
// no apunta a un stack local. Los specs también escriben con service-role.
import "../../helpers/supabase-env";

/** El stack al que escriben los specs; los helpers de e2e usan 127.0.0.1:54321 fijo. */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

/**
 * Toma el mismo candado de máquina que vitest (tests/helpers/supabase-lock.ts):
 * los specs escriben en la misma base y los barridos de otra corrida también los
 * alcanzan (legacy-verification.spec.ts siembra una cuenta heredada que
 * expire_grandfathered_verifications degrada). Playwright usa como teardown la
 * función que devuelve.
 */
export default async function globalSetup(config: FullConfig): Promise<() => void> {
  const lock = await acquireSupabaseLock(SUPABASE_URL);
  // Si el runner sale sin pasar por el teardown, el candado no queda colgado.
  process.once("exit", lock.release);
  if (lock.waited) await assertWebServerStillUp(config, lock.release);
  return lock.release;
}

/**
 * Playwright levanta o reutiliza el webServer ANTES del globalSetup. Si hubo que
 * esperar el candado, el servidor reutilizado pudo ser el de la corrida que lo
 * tenía, que lo apaga al terminar: se falla acá con el motivo y no con un
 * ERR_CONNECTION_REFUSED en cada spec.
 */
async function assertWebServerStillUp(config: FullConfig, release: () => void): Promise<void> {
  const url = config.webServer?.url;
  if (!url) return;
  try {
    await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    release();
    throw new Error(
      `El dev server de ${url} dejó de responder mientras esta corrida esperaba el candado del ` +
        `Supabase local. Lo más probable es que Playwright lo reutilizara al arrancar y fuera el de ` +
        `la corrida que tenía el candado, que lo apagó al terminar.\n` +
        `Vuelve a correr "npm run test:e2e". No se corrió ninguna prueba.`,
    );
  }
}
