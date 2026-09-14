import { describe, it, expect } from "vitest";
import {
  LEGACY_VERIFICATION_DEADLINE,
  legacyVerificationState,
  type VerificationStatus,
} from "@/lib/verification";

// Qué ve una cuenta heredada (aprobada por el backfill de la 0032 sin revisar
// credenciales): si todavía debe subir documentos o si ya espera la revisión.
// Tiene que coincidir con el predicado de expire_grandfathered_verifications.

const NOTA_HEREDADA =
  "Cuenta anterior a la verificación obligatoria; pendiente de revisión retroactiva.";

function cuenta(overrides: Partial<Parameters<typeof legacyVerificationState>[0]> = {}) {
  return {
    status: "verified" as VerificationStatus,
    notes: NOTA_HEREDADA,
    hasIdDocument: false,
    hasLicenseDocument: false,
    ...overrides,
  };
}

describe("verificación heredada", () => {
  it("una cuenta heredada sin documentos tiene que aportarlos", () => {
    expect(legacyVerificationState(cuenta())).toBe("needs_documents");
  });

  it("con cualquier documento ya espera la revisión retroactiva, sin perder el acceso", () => {
    expect(legacyVerificationState(cuenta({ hasIdDocument: true }))).toBe("awaiting_review");
    expect(legacyVerificationState(cuenta({ hasLicenseDocument: true }))).toBe("awaiting_review");
  });

  it("una verificación ya revisada no es heredada", () => {
    expect(
      legacyVerificationState(
        cuenta({ notes: "Verificación retroactiva confirmada el 20/09/2026." }),
      ),
    ).toBe("none");
    expect(legacyVerificationState(cuenta({ notes: null }))).toBe("none");
  });

  it("una heredada que el plazo ya degradó sigue el camino normal de verificación", () => {
    expect(legacyVerificationState(cuenta({ status: "pending_documents" }))).toBe("none");
  });

  it("el plazo vence el 18 de octubre de 2026 a las 23:59 en Bogotá", () => {
    expect(new Date(LEGACY_VERIFICATION_DEADLINE).toISOString()).toBe("2026-10-19T04:59:00.000Z");
  });
});
