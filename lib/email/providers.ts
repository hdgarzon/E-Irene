import { randomUUID } from "node:crypto";
import type { EmailMessage, EmailProvider } from "./types";

/** Sin RESEND_API_KEY o sin EMAIL_FROM: registra el email en consola (modo demo). */
export class LogEmailProvider implements EmailProvider {
  readonly mode = "log" as const;
  async send(msg: EmailMessage): Promise<{ id: string }> {
    console.info(`[email:log] → ${msg.to} · ${msg.subject}`);
    return { id: `log_${randomUUID()}` };
  }
}

interface ResendConfig {
  apiKey: string;
  from: string;
}

/**
 * Clave y remitente, sin espacios alrededor. Sin cualquiera de los dos el correo
 * no está configurado.
 *
 * El remitente es obligatorio y no tiene valor por defecto: antes se caía a
 * onboarding@resend.dev, el remitente de pruebas de Resend, que solo entrega al
 * dueño de la cuenta. Con la clave puesta y sin EMAIL_FROM, /admin/canales
 * mostraba el correo activo mientras los envíos a cualquier otra dirección
 * rebotaban.
 */
function resendConfig(): ResendConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

/** Con clave y remitente: envía vía la API REST de Resend (sin SDK). */
export class ResendEmailProvider implements EmailProvider {
  readonly mode = "resend" as const;
  constructor(private readonly config: ResendConfig) {}

  async send(msg: EmailMessage): Promise<{ id: string }> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
    const data = (await res.json()) as { id: string };
    return { id: data.id };
  }
}

export function getEmailProvider(): EmailProvider {
  const config = resendConfig();
  return config ? new ResendEmailProvider(config) : new LogEmailProvider();
}
