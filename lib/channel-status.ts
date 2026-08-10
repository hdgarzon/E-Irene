import { getEmailProvider } from "@/lib/email/providers";
import { getWhatsAppProvider } from "@/lib/whatsapp/providers";
import { getVideoProvider } from "@/lib/video";
import { getTranscriptionProvider, getAnalysisProvider } from "@/lib/providers";

/**
 * Estado real de los canales externos.
 *
 * Existe porque la ausencia de una credencial NO produce ningún error: cada
 * proveedor degrada a un modo simulado y la aplicación sigue como si nada.
 * Eso ya causó dos problemas concretos: correos que se daban por enviados sin
 * salir, y videollamadas con salas falsas a las que nadie se puede conectar.
 *
 * Una sola función lo responde, y de ella cuelgan tanto los avisos al usuario
 * como el panel de administración. Antes cada sitio lo deducía por su cuenta
 * —o no lo deducía.
 */

export type ChannelMode = "live" | "simulated";

export interface ChannelStatus {
  key: string;
  label: string;
  mode: ChannelMode;
  /** Variables de entorno que faltan para activarlo. */
  missing: string[];
  /** Qué deja de funcionar mientras esté simulado. */
  impact: string;
}

function has(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export function getChannelStatuses(): ChannelStatus[] {
  return [
    {
      key: "transcription",
      label: "Transcripción",
      mode: getTranscriptionProvider().mode === "mock" ? "simulated" : "live",
      missing: has("DEEPGRAM_API_KEY") ? [] : ["DEEPGRAM_API_KEY"],
      impact: "Las consultas no se transcriben: se muestra una sesión de ejemplo.",
    },
    {
      key: "analysis",
      label: "Análisis con IA",
      mode: getAnalysisProvider().mode === "mock" ? "simulated" : "live",
      missing: has("OPENAI_API_KEY") ? [] : ["OPENAI_API_KEY"],
      impact: "Los reportes se generan con un análisis de ejemplo, no clínico.",
    },
    {
      key: "email",
      label: "Correo",
      mode: getEmailProvider().mode === "log" ? "simulated" : "live",
      missing: [
        ...(has("RESEND_API_KEY") ? [] : ["RESEND_API_KEY"]),
        ...(has("EMAIL_FROM") ? [] : ["EMAIL_FROM"]),
      ],
      impact:
        "No sale ningún correo: recordatorios, enlaces de consentimiento y escalas al paciente, y alertas de riesgo al profesional.",
    },
    {
      key: "whatsapp",
      label: "WhatsApp",
      mode: getWhatsAppProvider().mode === "log" ? "simulated" : "live",
      missing: has("TWILIO_ACCOUNT_SID") ? [] : ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
      impact: "No sale ningún recordatorio por WhatsApp.",
    },
    {
      key: "video",
      label: "Videollamada",
      mode: getVideoProvider().mode === "mock" ? "simulated" : "live",
      missing: [
        ...(has("DAILY_API_KEY") ? [] : ["DAILY_API_KEY"]),
        ...(has("NEXT_PUBLIC_SITE_URL") ? [] : ["NEXT_PUBLIC_SITE_URL"]),
      ],
      impact:
        "Las salas son falsas (mock.video) y ni el profesional ni el paciente pueden conectarse.",
    },
  ];
}

/** Atajo para las rutas de telemedicina, que es donde más daño hace. */
export function isVideoSimulated(): boolean {
  return getVideoProvider().mode === "mock";
}
