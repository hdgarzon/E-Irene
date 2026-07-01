import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Cliente Supabase para Server Components / Route Handlers / Server Actions.
 * Usa la sesión del usuario (cookies) → RLS se aplica con su JWT.
 * En Next 16, `cookies()` es async.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Invocado desde un Server Component (cookies de solo lectura):
            // el refresco de sesión lo maneja proxy.ts. Se puede ignorar.
          }
        },
      },
      global: {
        // Sin esto, las peticiones de Supabase pasan por el fetch parcheado
        // de Next.js y pueden quedar atrapadas en su Data Cache — un GET
        // recién hecho después de guardar (Server Action + revalidatePath)
        // puede devolver datos desactualizados. cache: "no-store" fuerza a
        // que cada request a Supabase sea siempre fresca.
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    },
  );
}
