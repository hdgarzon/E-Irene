import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Cliente con service-role (BYPASS RLS). Úsalo SOLO en el servidor y solo para
 * tareas de sistema controladas (p.ej. escribir audit_logs cross-tenant, jobs).
 * Nunca lo expongas al cliente ni lo uses para datos scoped por usuario.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
