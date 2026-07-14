import { describe, it, expect, beforeEach } from "vitest";
import { getEmailProvider, LogEmailProvider } from "@/lib/email/providers";
import { buildReminderEmail, buildReportReadyEmail, buildRiskAlertEmail } from "@/lib/email/templates";

describe("email", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("sin RESEND_API_KEY usa el provider de log", () => {
    expect(getEmailProvider()).toBeInstanceOf(LogEmailProvider);
    expect(getEmailProvider().mode).toBe("log");
  });

  it("plantilla de recordatorio incluye nombre, fecha y hora", () => {
    const msg = buildReminderEmail({
      to: "ana@correo.co",
      patientName: "Ana",
      clinicName: "Centro Irene",
      dateLabel: "lunes, 15 de enero de 2030",
      timeLabel: "09:00",
    });
    expect(msg.to).toBe("ana@correo.co");
    expect(msg.subject).toContain("Recordatorio");
    expect(msg.html).toContain("Ana");
    expect(msg.html).toContain("09:00");
    expect(msg.text).toContain("Centro Irene");
  });

  it("plantilla reporte listo no expone contenido clínico", () => {
    const msg = buildReportReadyEmail({
      to: "ana@correo.co",
      patientName: "Ana",
      clinicName: "Centro Irene",
    });
    expect(msg.subject).toContain("resumen");
    expect(msg.html).toContain("no se envía por correo");
  });

  it("plantilla de alerta de riesgo no expone datos clínicos", () => {
    const msg = buildRiskAlertEmail({
      to: "doctor@correo.co",
      doctorName: "Dra. Pérez",
      patientName: "Ana",
      clinicName: "Centro Irene",
      patientUrl: "https://e-irene.co/patients/abc-123",
    });
    expect(msg.to).toBe("doctor@correo.co");
    expect(msg.subject).toContain("Alerta");
    expect(msg.html).toContain("Ana");
    expect(msg.html).toContain("https://e-irene.co/patients/abc-123");
    expect(msg.html).not.toMatch(/PHQ|puntaje|sever/i);
    expect(msg.text).toContain("Ana");
  });

  it("el log provider devuelve un id", async () => {
    const res = await new LogEmailProvider().send({
      to: "x@y.co",
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
    expect(res.id).toMatch(/^log_/);
  });
});
