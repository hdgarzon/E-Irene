import { randomUUID } from "node:crypto";
import type { EmailMessage, EmailProvider } from "./types";

/** Sin RESEND_API_KEY: registra el email en consola (modo demo). */
export class LogEmailProvider implements EmailProvider {
  readonly mode = "log" as const;
  async send(msg: EmailMessage): Promise<{ id: string }> {
    console.info(`[email:log] → ${msg.to} · ${msg.subject}`);
    return { id: `log_${randomUUID()}` };
  }
}

/** Con RESEND_API_KEY: envía vía la API REST de Resend (sin SDK). */
export class ResendEmailProvider implements EmailProvider {
  readonly mode = "resend" as const;
  async send(msg: EmailMessage): Promise<{ id: string }> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "E-Irene <onboarding@resend.dev>",
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
  return process.env.RESEND_API_KEY ? new ResendEmailProvider() : new LogEmailProvider();
}
