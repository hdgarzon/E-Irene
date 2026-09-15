import { createClient } from "@supabase/supabase-js";
import type { TestProject } from "vitest/node";
import { isLocalSupabase } from "./supabase-env";
import { acquireSupabaseLock, releaseSupabaseLock, supabaseLockPath } from "./supabase-lock";

/** URL del Supabase local si hay credenciales para escribir en él. */
function localSupabaseUrl(): string | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Sin stack, las pruebas que lo necesitan se saltan solas; con una URL remota,
  // supabase-env.ts ya aborta al importarse.
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY || !isLocalSupabase(url)) return undefined;
  return url;
}

/**
 * Comprobación previa de toda la suite: si hay credenciales de Supabase, el stack
 * que responde en esa URL tiene que ser el de e-irene.
 *
 * POR QUÉ EXISTE
 *   supabase-env.ts comprueba que la URL sea local, pero no de qué proyecto es.
 *   Todos los proyectos de Supabase usan por defecto los mismos puertos (54321…)
 *   y las mismas claves locales: con otro proyecto levantado en esos puertos, la
 *   suite escribe en su base. Pasó dos veces en septiembre de 2026.
 *
 *   Se comprueba con una función que solo existe en el esquema de e-irene
 *   (billing_grace_period, migración 0041) y antes de que corra ningún archivo
 *   de pruebas: abortar aquí no deja escribir ni un registro.
 */
async function checkSupabaseProject(url: string): Promise<void> {
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.rpc("billing_grace_period");
  if (error) {
    throw new Error(
      `El Supabase que responde en ${url} no es el de e-irene o no tiene sus migraciones ` +
        `(${error.code || "sin código"}: ${error.message}).\n` +
        `Si otro proyecto local ocupa esos puertos, detenlo ("supabase stop --project-id <proyecto>") ` +
        `y levanta el de e-irene ("supabase start"); si faltan migraciones, "supabase migration up --local".\n` +
        `No se corrió ninguna prueba: no se escribió nada en esa base.`,
    );
  }
}

/**
 * Toma el candado de máquina (supabase-lock.ts) y comprueba el proyecto. Si la
 * comprobación falla, lo suelta: no va a correr ninguna prueba y no hay por qué
 * hacer esperar a otra corrida.
 */
async function lockAndCheck(): Promise<void> {
  const url = localSupabaseUrl();
  if (!url) return;
  const lock = await acquireSupabaseLock(url);
  try {
    await checkSupabaseProject(url);
  } catch (error) {
    lock.release();
    throw error;
  }
}

export default async function setup(project: TestProject): Promise<() => void> {
  const url = localSupabaseUrl();
  const release = () => {
    if (url) releaseSupabaseLock(supabaseLockPath(url));
  };
  // Si vitest sale sin pasar por el teardown, el candado no queda colgado hasta
  // que otra corrida note que este pid ya no existe.
  process.once("exit", release);

  await lockAndCheck();
  // En modo watch el globalSetup corre una sola vez. Cada re-ejecución vuelve a
  // tomar el candado —el plugin de vitest.config.ts lo suelta al terminar cada
  // corrida, así un watch inactivo no bloquea a otras sesiones— y a comprobar
  // que otro proyecto no haya tomado los puertos a mitad de la sesión.
  project.onTestsRerun(lockAndCheck);
  return release;
}
