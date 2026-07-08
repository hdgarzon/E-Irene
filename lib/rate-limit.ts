import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/**
 * IP del cliente a partir de las cabeceras de proxy (Vercel/Supabase ponen
 * `x-forwarded-for`). Se usa como parte de la clave de rate limiting.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * true si la acción está DENTRO del límite; false si lo excede. Respaldado por
 * la función `check_rate_limit` de Postgres (ventana fija, atómica, distribuida).
 *
 * Fail-open: si la BD falla, se permite la acción (el rate limiting es un
 * control secundario; no debe bloquear el login por un problema de infraestructura).
 * El fallo se registra para poder investigarlo.
 *
 * `RATE_LIMITING_DISABLED=true` desactiva el límite: se usa SOLO en la suite
 * E2E (misma idea que forzar los proveedores mock por env), donde todos los
 * tests hacen signup/login desde la misma IP del runner y agotarían el límite.
 * Nunca debe activarse en producción.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  if (process.env.RATE_LIMITING_DISABLED === "true") return true;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("[rate-limit] no se pudo verificar el límite:", error);
    return true;
  }
  return data === true;
}
