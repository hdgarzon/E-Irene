/**
 * Origen público de la app, normalizado.
 *
 * NEXT_PUBLIC_APP_URL debería ser solo el origen ("https://e-irene.co"), pero
 * es una variable de entorno que se edita a mano en el dashboard de Vercel y
 * ya llegó a producción con una ruta pegada al final
 * ("https://e-irene.co/settings/plan?wompi=return"). El resultado fueron URLs
 * concatenadas dos veces, en lugares donde el daño no es evidente:
 *
 *   - links de consentimiento y de escalas PHQ-9 enviados a PACIENTES
 *     (lib/patient-links.ts) — un paciente con un link roto simplemente no
 *     puede responder, y nadie se entera;
 *   - links de alertas de riesgo enviados al doctor tratante;
 *   - redirect_url del checkout de Wompi.
 *
 * Por eso la normalización vive acá y no en cada llamador: descarta ruta,
 * query y hash, y se queda solo con el origen. Un valor mal escrito degrada
 * a algo funcional en vez de romper links en silencio.
 */
const FALLBACK_ORIGIN = "https://e-irene.co";

export function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return FALLBACK_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    // Valor no parseable como URL absoluta: mejor el dominio conocido que
    // propagar algo roto a un correo de paciente.
    return FALLBACK_ORIGIN;
  }
}
