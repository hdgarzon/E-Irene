import { describe, it, expect, beforeEach } from "vitest";
import {
  getWhatsAppProvider,
  LogWhatsAppProvider,
  buildReminderWhatsApp,
} from "@/lib/whatsapp/providers";

describe("whatsapp", () => {
  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });

  it("sin credenciales usa el provider de log", () => {
    expect(getWhatsAppProvider()).toBeInstanceOf(LogWhatsAppProvider);
    expect(getWhatsAppProvider().mode).toBe("log");
  });

  it("el mensaje de recordatorio incluye nombre, fecha y hora", () => {
    const body = buildReminderWhatsApp({
      patientName: "Sofía",
      clinicName: "Centro Irene",
      dateLabel: "lunes, 20 de febrero",
      timeLabel: "10:00",
    });
    expect(body).toContain("Sofía");
    expect(body).toContain("Centro Irene");
    expect(body).toContain("10:00");
  });

  it("el log provider devuelve un id", async () => {
    const res = await new LogWhatsAppProvider().send({ to: "+573001234567", body: "hola" });
    expect(res.id).toMatch(/^wa_log_/);
  });
});
