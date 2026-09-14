import { createClient } from "@supabase/supabase-js";
import { isLocalSupabase } from "./supabase-env";

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
export default async function checkSupabaseProject(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Sin stack, las pruebas que lo necesitan se saltan solas; con una URL remota,
  // supabase-env.ts ya aborta al importarse.
  if (!url || !serviceKey || !isLocalSupabase(url)) return;

  const client = createClient(url, serviceKey, {
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
