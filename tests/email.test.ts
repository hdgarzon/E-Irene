import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getEmailProvider, LogEmailProvider, ResendEmailProvider } from "@/lib/email/providers";
import {
  buildReminderEmail,
  buildReportReadyEmail,
  buildRiskAlertEmail,
  buildPhq9RiskAlertEmail,
  buildPatientLinkEmail,
  escapeHtml,
} from "@/lib/email/templates";
import type { EmailMessage } from "@/lib/email/types";

const INYECCION = '<a href="https://example.com">x</a>';
const INYECCION_ESCAPADA = "&lt;a href=&quot;https://example.com&quot;&gt;x&lt;/a&gt;";

describe("email", () => {
  const saved = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM };

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });
  afterEach(() => {
    for (const [name, value] of [
      ["RESEND_API_KEY", saved.key],
      ["EMAIL_FROM", saved.from],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("sin RESEND_API_KEY usa el provider de log", () => {
    expect(getEmailProvider()).toBeInstanceOf(LogEmailProvider);
    expect(getEmailProvider().mode).toBe("log");
  });

  it("con clave pero sin remitente sigue en log: no cae al remitente de pruebas de Resend", () => {
    // onboarding@resend.dev solo entrega al dueño de la cuenta: con él, el panel
    // decía "activo" mientras los correos a cualquier otra dirección rebotaban.
    process.env.RESEND_API_KEY = "re_test_xxx";
    expect(getEmailProvider()).toBeInstanceOf(LogEmailProvider);
    process.env.EMAIL_FROM = "   ";
    expect(getEmailProvider().mode).toBe("log");
  });

  it("con clave y remitente envía por Resend, con ese remitente", async () => {
    process.env.RESEND_API_KEY = "re_test_xxx";
    process.env.EMAIL_FROM = " E-Irene <notificaciones@example.com> ";
    const provider = getEmailProvider();
    expect(provider).toBeInstanceOf(ResendEmailProvider);

    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await provider.send({
        to: "paciente@example.com",
        subject: "Prueba",
        html: "<p>Prueba</p>",
        text: "Prueba",
      });
      expect(res.id).toBe("email_1");
    } finally {
      vi.unstubAllGlobals();
    }

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(String(init.body)).from).toBe("E-Irene <notificaciones@example.com>");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_xxx");
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

  it("plantilla de alerta de riesgo (análisis de IA) incluye categoría/nivel pero no la cita textual", () => {
    const msg = buildRiskAlertEmail({
      to: "doctor@correo.co",
      doctorName: "Dra. Pérez",
      patientName: "Ana",
      clinicName: "Centro Irene",
      consultationUrl: "https://e-irene.co/consultations/abc-123",
      categories: [{ label: "Ideación suicida", level: "alto" }],
    });
    expect(msg.to).toBe("doctor@correo.co");
    expect(msg.subject).toContain("Alerta");
    expect(msg.html).toContain("Ana");
    expect(msg.html).toContain("Ideación suicida");
    expect(msg.html).toContain("https://e-irene.co/consultations/abc-123");
    expect(msg.text).toContain("Ana");
  });

  it("plantilla de alerta de riesgo (PHQ-9 autorreportado) no nombra la categoría ni expone datos clínicos", () => {
    const msg = buildPhq9RiskAlertEmail({
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
    expect(msg.html).not.toMatch(/PHQ|puntaje|sever|autolesión/i);
    expect(msg.text).toContain("Ana");
  });

  describe("escape de HTML", () => {
    it("escapeHtml cubre & < > \" '", () => {
      expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    });

    // Nombre de paciente, clínica y doctor los escribe un tercero. El mismo
    // payload va en todos los campos: si alguno queda sin escapar, el `<a>`
    // aparece literal en el HTML.
    const casos: [string, () => EmailMessage][] = [
      [
        "recordatorio",
        () =>
          buildReminderEmail({
            to: "paciente@example.com",
            patientName: INYECCION,
            clinicName: INYECCION,
            dateLabel: INYECCION,
            timeLabel: INYECCION,
            videoJoinUrl: "https://e-irene.co/join/tok",
          }),
      ],
      [
        "reporte listo",
        () =>
          buildReportReadyEmail({
            to: "paciente@example.com",
            patientName: INYECCION,
            clinicName: INYECCION,
          }),
      ],
      [
        "alerta de riesgo (IA)",
        () =>
          buildRiskAlertEmail({
            to: "doctor@example.com",
            doctorName: INYECCION,
            patientName: INYECCION,
            clinicName: INYECCION,
            consultationUrl: "https://e-irene.co/consultations/abc-123",
            categories: [{ label: INYECCION, level: INYECCION }],
          }),
      ],
      [
        "alerta PHQ-9",
        () =>
          buildPhq9RiskAlertEmail({
            to: "doctor@example.com",
            doctorName: INYECCION,
            patientName: INYECCION,
            clinicName: INYECCION,
            patientUrl: "https://e-irene.co/patients/abc-123",
          }),
      ],
      [
        "enlace al paciente",
        () =>
          buildPatientLinkEmail({
            to: "paciente@example.com",
            patientName: INYECCION,
            clinicName: INYECCION,
            url: "https://e-irene.co/enlace/tok",
            purpose: "consent",
          }),
      ],
    ];

    it.each(casos)("%s: sale escapado en html y literal en text", (_nombre, build) => {
      const msg = build();
      expect(msg.html).not.toContain(INYECCION);
      expect(msg.html).not.toContain('href="https://example.com"');
      expect(msg.html).toContain(INYECCION_ESCAPADA);
      expect(msg.text).toContain(INYECCION);
    });

    it("una URL con comillas no rompe el atributo href", () => {
      const msg = buildPatientLinkEmail({
        to: "paciente@example.com",
        patientName: "Paciente Demo",
        clinicName: "Clínica Demo",
        url: 'https://e-irene.co/enlace/tok" onclick="alert(1)',
        purpose: "assessment",
      });
      expect(msg.html).not.toContain('" onclick="');
      expect(msg.html).toContain("&quot; onclick=&quot;");
    });

    it("una URL que no es http(s) no se vuelve enlace", () => {
      const msg = buildReminderEmail({
        to: "paciente@example.com",
        patientName: "Paciente Demo",
        clinicName: "Clínica Demo",
        dateLabel: "lunes",
        timeLabel: "09:00",
        videoJoinUrl: "javascript:alert(1)",
      });
      expect(msg.html).not.toContain("javascript:");
      expect(msg.html).not.toContain("<a ");
    });

    // Una URL inválida no debe impedir que la alerta llegue: el llamador
    // captura cualquier error de la plantilla y el doctor quedaría sin aviso.
    it("alerta de riesgo (IA) con URL inválida: el aviso sale igual, sin enlace", () => {
      const msg = buildRiskAlertEmail({
        to: "doctor@example.com",
        doctorName: "Doctora Demo",
        patientName: "Paciente Demo",
        clinicName: "Clínica Demo",
        consultationUrl: "javascript:alert(1)",
        categories: [{ label: "Ideación suicida", level: "alto" }],
      });
      expect(msg.to).toBe("doctor@example.com");
      expect(msg.subject).toContain("Paciente Demo");
      expect(msg.html).toContain("Paciente Demo");
      expect(msg.html).toContain("Ideación suicida (alto)");
      expect(msg.html).toContain("en la plataforma");
      expect(msg.html).not.toContain("javascript:");
    });

    it("alerta PHQ-9 con URL inválida: el aviso sale igual, sin enlace", () => {
      const msg = buildPhq9RiskAlertEmail({
        to: "doctor@example.com",
        doctorName: "Doctora Demo",
        patientName: "Paciente Demo",
        clinicName: "Clínica Demo",
        patientUrl: "data:text/html,<script>alert(1)</script>",
      });
      expect(msg.to).toBe("doctor@example.com");
      expect(msg.subject).toContain("Alerta");
      expect(msg.html).toContain("Paciente Demo");
      expect(msg.html).toContain("en la plataforma");
      expect(msg.html).not.toContain("data:");
      expect(msg.html).not.toContain("<script>");
    });
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
