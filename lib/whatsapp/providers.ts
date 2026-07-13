import { randomUUID } from "node:crypto";

export interface WhatsAppMessage {
  to: string; // E.164, p.ej. +573001234567
  body: string;
}

export type WhatsAppMode = "log" | "twilio";

export interface WhatsAppProvider {
  readonly mode: WhatsAppMode;
  send(msg: WhatsAppMessage): Promise<{ id: string }>;
}

/** Sin credenciales Twilio: registra el mensaje en consola (modo demo). */
export class LogWhatsAppProvider implements WhatsAppProvider {
  readonly mode = "log" as const;
  async send(msg: WhatsAppMessage): Promise<{ id: string }> {
    console.info(`[whatsapp:log] → ${msg.to} · ${msg.body.slice(0, 40)}…`);
    return { id: `wa_log_${randomUUID()}` };
  }
}

/** Con credenciales Twilio: envía vía la API REST (sin SDK). */
export class TwilioWhatsAppProvider implements WhatsAppProvider {
  readonly mode = "twilio" as const;
  async send(msg: WhatsAppMessage): Promise<{ id: string }> {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886";
    const body = new URLSearchParams({
      From: from,
      To: `whatsapp:${msg.to}`,
      Body: msg.body,
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!res.ok) throw new Error(`Twilio respondió ${res.status}`);
    const data = (await res.json()) as { sid: string };
    return { id: data.sid };
  }
}

export function getWhatsAppProvider(): WhatsAppProvider {
  return process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? new TwilioWhatsAppProvider()
    : new LogWhatsAppProvider();
}

export function buildReminderWhatsApp(input: {
  patientName: string;
  clinicName: string;
  dateLabel: string;
  timeLabel: string;
  videoJoinUrl?: string;
}): string {
  const videoLine = input.videoJoinUrl
    ? ` Es por video, entra aquí a la hora de tu cita: ${input.videoJoinUrl}`
    : "";
  return `Hola ${input.patientName} 👋 Te recordamos tu cita en ${input.clinicName} el ${input.dateLabel} a las ${input.timeLabel}.${videoLine} — E-Irene`;
}
