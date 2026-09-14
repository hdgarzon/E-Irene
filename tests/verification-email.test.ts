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
});
