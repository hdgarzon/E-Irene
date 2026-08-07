import { describe, it, expect } from "vitest";
import {
  buildDocumentPath,
  canAccessClinical,
  canSubmitDocuments,
  canTransition,
  isAwaitingReview,
  isOwnDocumentPath,
  roleRequiresVerification,
  validateDocumentFile,
  MAX_DOCUMENT_BYTES,
  VERIFICATION_LABELS,
  type VerificationStatus,
} from "@/lib/verification";

const ALL_STATUSES: VerificationStatus[] = [
  "pending_documents",
  "pending_review",
  "verified",
  "rejected",
  "suspended",
];

describe("verificación profesional: máquina de estados", () => {
  it("el camino feliz llega a verificado", () => {
    expect(canTransition("pending_documents", "pending_review")).toBe(true);
    expect(canTransition("pending_review", "verified")).toBe(true);
  });

  it("no se puede saltar la revisión y aprobarse desde el inicio", () => {
    expect(canTransition("pending_documents", "verified")).toBe(false);
  });

  it("un rechazo se puede corregir reenviando documentos", () => {
    expect(canTransition("rejected", "pending_review")).toBe(true);
  });

  it("rehabilitar a un suspendido exige pasar de nuevo por revisión", () => {
    expect(canTransition("suspended", "verified")).toBe(false);
    expect(canTransition("suspended", "pending_review")).toBe(true);
  });

  it("una verificación vigente se puede revocar", () => {
    expect(canTransition("verified", "suspended")).toBe(true);
  });

  it("no se puede rechazar a alguien ya verificado sin suspenderlo primero", () => {
    expect(canTransition("verified", "rejected")).toBe(false);
  });

  it("ningún estado puede transicionar a sí mismo", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("todo estado tiene etiqueta para la interfaz", () => {
    for (const status of ALL_STATUSES) {
      expect(VERIFICATION_LABELS[status]).toBeTruthy();
    }
  });
});

describe("verificación profesional: quién puede ejercer", () => {
  it("un doctor verificado puede crear registros clínicos", () => {
    expect(canAccessClinical({ role: "doctor", status: "verified" })).toBe(true);
  });

  it("un admin verificado también: es el rol que recibe quien crea la clínica", () => {
    expect(canAccessClinical({ role: "admin", status: "verified" })).toBe(true);
  });

  it("ningún estado distinto de verificado habilita el acceso clínico", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "verified")) {
      expect(canAccessClinical({ role: "doctor", status })).toBe(false);
      expect(canAccessClinical({ role: "admin", status })).toBe(false);
    }
  });

  it("a un doctor suspendido se le corta el acceso clínico", () => {
    expect(canAccessClinical({ role: "doctor", status: "suspended" })).toBe(false);
  });

  it("la secretaría depende de que su clínica tenga un profesional verificado", () => {
    expect(
      canAccessClinical({
        role: "secretaria",
        status: "pending_documents",
        clinicHasVerifiedProfessional: true,
      }),
    ).toBe(true);
    expect(
      canAccessClinical({
        role: "secretaria",
        status: "pending_documents",
        clinicHasVerifiedProfessional: false,
      }),
    ).toBe(false);
  });

  it("sin dato de la clínica, la secretaría no pasa (falla cerrado)", () => {
    expect(canAccessClinical({ role: "secretaria", status: "verified" })).toBe(false);
  });

  it("el rol paciente nunca crea registros clínicos", () => {
    expect(canAccessClinical({ role: "paciente", status: "verified" })).toBe(false);
  });

  it("solo admin y doctor deben verificarse ellos mismos", () => {
    expect(roleRequiresVerification("admin")).toBe(true);
    expect(roleRequiresVerification("doctor")).toBe(true);
    expect(roleRequiresVerification("secretaria")).toBe(false);
    expect(roleRequiresVerification("paciente")).toBe(false);
  });
});

describe("verificación profesional: envío de documentos", () => {
  it("se puede enviar desde documentos pendientes y tras un rechazo", () => {
    expect(canSubmitDocuments("pending_documents")).toBe(true);
    expect(canSubmitDocuments("rejected")).toBe(true);
  });

  it("no se puede reenviar mientras está en revisión ni ya verificado", () => {
    expect(canSubmitDocuments("pending_review")).toBe(false);
    expect(canSubmitDocuments("verified")).toBe(false);
  });

  it("solo lo que está en revisión aparece como accionable para el admin", () => {
    expect(isAwaitingReview("pending_review")).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== "pending_review")) {
      expect(isAwaitingReview(status)).toBe(false);
    }
  });
});

describe("verificación profesional: rutas de documentos", () => {
  const CLINIC = "clinica-1";
  const USER = "user-1";

  it("la ruta empieza por clínica y usuario, como exige la política del bucket", () => {
    const path = buildDocumentPath({
      clinicId: CLINIC,
      userId: USER,
      kind: "cedula",
      fileName: "foto.JPG",
    });
    expect(path.startsWith(`${CLINIC}/${USER}/`)).toBe(true);
    expect(path).toMatch(/\/cedula-\d+\.jpg$/);
  });

  it("un archivo sin extensión no rompe la ruta", () => {
    const path = buildDocumentPath({
      clinicId: CLINIC,
      userId: USER,
      kind: "tarjeta",
      fileName: "escaneo",
    });
    expect(path).toMatch(/\/tarjeta-\d+\.bin$/);
  });

  it("acepta la ruta propia", () => {
    const path = buildDocumentPath({
      clinicId: CLINIC,
      userId: USER,
      kind: "cedula",
      fileName: "c.pdf",
    });
    expect(isOwnDocumentPath(path, CLINIC, USER)).toBe(true);
  });

  it("rechaza la ruta de otro profesional de la misma clínica", () => {
    expect(isOwnDocumentPath(`${CLINIC}/otro-user/cedula-1.pdf`, CLINIC, USER)).toBe(false);
  });

  it("rechaza la ruta de otra clínica", () => {
    expect(isOwnDocumentPath(`otra-clinica/${USER}/cedula-1.pdf`, CLINIC, USER)).toBe(false);
  });

  it("rechaza intentos de salir de la carpeta", () => {
    expect(isOwnDocumentPath(`${CLINIC}/${USER}/../../otra/x.pdf`, CLINIC, USER)).toBe(false);
  });
});

describe("verificación profesional: validación de archivos", () => {
  const ok = { size: 1000, type: "image/jpeg" };

  it("acepta una foto normal", () => {
    expect(validateDocumentFile(ok, "tu cédula")).toBeNull();
  });

  it("exige que haya archivo", () => {
    expect(validateDocumentFile(null, "tu cédula")).toContain("Adjunta");
    expect(validateDocumentFile({ size: 0, type: "image/jpeg" }, "tu cédula")).toContain("Adjunta");
  });

  it("rechaza archivos por encima del límite", () => {
    expect(
      validateDocumentFile({ size: MAX_DOCUMENT_BYTES + 1, type: "image/jpeg" }, "tu cédula"),
    ).toContain("5 MB");
  });

  it("rechaza formatos no aceptados", () => {
    expect(validateDocumentFile({ size: 1000, type: "application/zip" }, "tu cédula")).toContain(
      "JPG",
    );
  });

  it("acepta PDF, que es como llegan muchos escaneos", () => {
    expect(validateDocumentFile({ size: 1000, type: "application/pdf" }, "tu cédula")).toBeNull();
  });
});
