import { describe, it, expect } from "vitest";
import {
  buildLegacyDocumentsReturnedEmail,
  buildVerificationDecisionEmail,
} from "@/lib/email/templates";

const base = {
  to: "doctora@ejemplo.co",
  doctorName: "Irene Pérez Gómez",
  actionUrl: "https://e-irene.co/verificacion",
};

describe("correo de decisión de verificación", () => {
  it("saluda por el nombre de pila, no por el nombre completo", () => {
    const mail = buildVerificationDecisionEmail({ ...base, decision: "verified" });
    expect(mail.text).toContain("Hola Irene");
    expect(mail.text).not.toContain("Pérez Gómez");
  });

  it("no usa el pie de correo de paciente", () => {
    // wrap() dice "mensaje automático de tu profesional de salud mental", que
    // es falso en un correo que E-Irene manda al propio profesional.
    const mail = buildVerificationDecisionEmail({ ...base, decision: "verified" });
    expect(mail.html).not.toContain("tu profesional de salud mental");
    expect(mail.html).toContain("tu cuenta profesional");
  });

  describe("aprobación", () => {
    const mail = buildVerificationDecisionEmail({
      ...base,
      decision: "verified",
      actionUrl: "https://e-irene.co/dashboard",
    });

    it("dice que fue aprobada y a dónde entrar", () => {
      expect(mail.subject).toMatch(/aprobada/i);
      expect(mail.html).toContain("https://e-irene.co/dashboard");
    });

    it("no filtra notas internas del revisor", () => {
      const conNota = buildVerificationDecisionEmail({
        ...base,
        decision: "verified",
        notes: "cotejado en ReTHUS por HG",
      });
      expect(conNota.html).not.toContain("cotejado en ReTHUS");
      expect(conNota.text).not.toContain("cotejado en ReTHUS");
    });
  });

  describe("rechazo", () => {
    const mail = buildVerificationDecisionEmail({
      ...base,
      decision: "rejected",
      notes: "La foto de la tarjeta profesional está ilegible",
    });

    it("incluye el motivo: sin él, el profesional no sabe qué corregir", () => {
      expect(mail.html).toContain("La foto de la tarjeta profesional está ilegible");
      expect(mail.text).toContain("La foto de la tarjeta profesional está ilegible");
    });

    it("lleva a reenviar documentos", () => {
      expect(mail.html).toContain("https://e-irene.co/verificacion");
      expect(mail.html).toMatch(/reenviar documentos/i);
    });

    it("aclara que no pierde acceso a las historias que ya creó", () => {
      expect(mail.html).toMatch(/sigues? siendo responsable|siguen accesibles/i);
    });
  });

  describe("suspensión", () => {
    const mail = buildVerificationDecisionEmail({
      ...base,
      decision: "suspended",
      notes: "Inhabilitación reportada por el tribunal ético",
    });

    it("dice que fue suspendida e incluye el motivo", () => {
      expect(mail.subject).toMatch(/suspendida/i);
      expect(mail.html).toContain("Inhabilitación reportada");
    });

    it("no invita a reenviar documentos: se resuelve por contacto", () => {
      expect(mail.html).not.toMatch(/reenviar documentos/i);
      expect(mail.html).toMatch(/responde a este correo/i);
    });
  });

  describe("escape de HTML", () => {
    const INYECCION = '<a href="https://example.com">x</a>';

    it("el motivo sale escapado en html y literal en text", () => {
      const mail = buildVerificationDecisionEmail({ ...base, decision: "rejected", notes: INYECCION });
      expect(mail.html).not.toContain(INYECCION);
      expect(mail.html).not.toContain('href="https://example.com"');
      expect(mail.html).toContain("&lt;a href=&quot;https://example.com&quot;&gt;x&lt;/a&gt;");
      expect(mail.text).toContain(INYECCION);
    });

    it("el nombre de pila sale escapado", () => {
      const mail = buildVerificationDecisionEmail({
        ...base,
        doctorName: '<img src="https://example.com/x.png"> Demo',
        decision: "verified",
      });
      expect(mail.html).not.toContain("<img");
      expect(mail.html).toContain("&lt;img");
    });

    it("con URL que no es http(s), el rechazo no lleva enlace pero sigue indicando qué hacer", () => {
      const mail = buildVerificationDecisionEmail({
        ...base,
        decision: "rejected",
        notes: "Documento ilegible",
        actionUrl: "javascript:alert(1)",
      });
      expect(mail.html).not.toContain("javascript:");
      expect(mail.html).toMatch(/volver a enviar tus documentos/i);
      expect(mail.html).toContain("Documento ilegible");
    });
  });

  it("sin motivo, el correo sigue siendo coherente", () => {
    const mail = buildVerificationDecisionEmail({ ...base, decision: "rejected", notes: null });
    expect(mail.html).not.toContain("Motivo:");
    expect(mail.subject).toBeTruthy();
    expect(mail.text).toBeTruthy();
  });
});

describe("correo de documentos devueltos a una cuenta heredada", () => {
  const mail = buildLegacyDocumentsReturnedEmail({
    ...base,
    reason: "La foto de la cédula está cortada",
    deadline: "18 de octubre de 2026",
  });

  it("incluye el motivo y el plazo", () => {
    expect(mail.html).toContain("La foto de la cédula está cortada");
    expect(mail.text).toContain("La foto de la cédula está cortada");
    expect(mail.html).toContain("18 de octubre de 2026");
    expect(mail.text).toContain("18 de octubre de 2026");
  });

  it("no es un rechazo: aclara que conserva el acceso y lleva a subirlos", () => {
    expect(mail.subject).not.toMatch(/no pudimos verificar/i);
    expect(mail.html).not.toMatch(/no pudimos confirmar/i);
    expect(mail.html).toMatch(/conservas el acceso/i);
    expect(mail.html).toContain("https://e-irene.co/verificacion");
  });

  it("usa el pie de la plataforma, no el de paciente", () => {
    expect(mail.html).toContain("tu cuenta profesional");
  });

  it("el motivo, el nombre y el plazo salen escapados en html y literales en text", () => {
    const INYECCION = '<a href="https://example.com">x</a>';
    const conInyeccion = buildLegacyDocumentsReturnedEmail({
      ...base,
      doctorName: '<img src="https://example.com/x.png"> Demo',
      reason: INYECCION,
      deadline: INYECCION,
    });
    expect(conInyeccion.html).not.toContain(INYECCION);
    expect(conInyeccion.html).not.toContain('href="https://example.com"');
    expect(conInyeccion.html).not.toContain("<img");
    expect(conInyeccion.html).toContain("&lt;a href=&quot;https://example.com&quot;&gt;x&lt;/a&gt;");
    expect(conInyeccion.text).toContain(INYECCION);
  });

  it("con URL que no es http(s) no lleva enlace pero conserva motivo y plazo", () => {
    const sinEnlace = buildLegacyDocumentsReturnedEmail({
      ...base,
      reason: "La foto de la cédula está cortada",
      deadline: "18 de octubre de 2026",
      actionUrl: "javascript:alert(1)",
    });
    expect(sinEnlace.html).not.toContain("javascript:");
    expect(sinEnlace.html).toContain("La foto de la cédula está cortada");
    expect(sinEnlace.html).toContain("18 de octubre de 2026");
  });
});
