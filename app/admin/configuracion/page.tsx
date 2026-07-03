import { ExternalLink, KeyRound, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const VERCEL_ENV_URL =
  "https://vercel.com/henry-garzons-projects/e-irene/settings/environment-variables";

interface EnvVar {
  name: string;
  desc: string;
  secret: boolean;
}

const GROUPS: { title: string; vars: EnvVar[] }[] = [
  {
    title: "IA y reportes",
    vars: [
      { name: "ANALYSIS_PROVIDER", desc: "Proveedor de análisis: 'openai' o 'mock'.", secret: false },
      { name: "TRANSCRIPTION_PROVIDER", desc: "Proveedor de transcripción: 'deepgram' o 'mock'.", secret: false },
      { name: "OPENAI_API_KEY", desc: "Clave de OpenAI (análisis de sesiones).", secret: true },
      { name: "DEEPGRAM_API_KEY", desc: "Clave de Deepgram (transcripción en vivo).", secret: true },
    ],
  },
  {
    title: "Notificaciones",
    vars: [
      { name: "RESEND_API_KEY", desc: "Clave de Resend (envío de correos).", secret: true },
      { name: "EMAIL_FROM", desc: "Remitente de los correos.", secret: false },
      { name: "TWILIO_ACCOUNT_SID", desc: "Twilio (WhatsApp) — SID de cuenta.", secret: true },
      { name: "TWILIO_AUTH_TOKEN", desc: "Twilio (WhatsApp) — token.", secret: true },
      { name: "TWILIO_WHATSAPP_FROM", desc: "Número de WhatsApp emisor.", secret: false },
    ],
  },
  {
    title: "Infraestructura (no cambiar sin cuidado)",
    vars: [
      { name: "ENCRYPTION_KEY", desc: "Clave AES de la PII. Rotarla invalida los datos existentes.", secret: true },
      { name: "SUPABASE_SERVICE_ROLE_KEY", desc: "Clave service-role de Supabase.", secret: true },
      { name: "NEXT_PUBLIC_SUPABASE_URL", desc: "URL del proyecto Supabase.", secret: false },
    ],
  },
];

function maskedValue(name: string, secret: boolean): { set: boolean; display: string } {
  const raw = process.env[name];
  const set = Boolean(raw && raw.length > 0);
  if (!set) return { set: false, display: "No configurada" };
  if (!secret) return { set: true, display: raw! };
  return { set: true, display: "•••••••• configurada" };
}

export default function AdminConfiguracionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Variables de la plataforma. Por seguridad, los secretos se editan en Vercel, no aquí.
        </p>
      </div>

      <a
        href={VERCEL_ENV_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white hover:bg-navy/90"
      >
        <ExternalLink className="size-4" />
        Editar variables en Vercel
      </a>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="font-heading font-semibold text-navy">{group.title}</h2>
          <div className="divide-y divide-gray-line rounded-2xl border border-gray-line bg-card">
            {group.vars.map((v) => {
              const { set, display } = maskedValue(v.name, v.secret);
              return (
                <div key={v.name} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="flex items-center gap-1.5 font-mono text-sm text-navy">
                      {v.secret ? (
                        <KeyRound className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ShieldCheck className="size-3.5 text-muted-foreground" />
                      )}
                      {v.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{v.desc}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{display}</span>
                    <Badge className={set ? "bg-mint/20 text-[#04342a]" : "bg-coral/15 text-destructive"}>
                      {set ? "Configurada" : "Falta"}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
