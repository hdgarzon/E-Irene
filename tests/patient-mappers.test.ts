import { describe, it, expect, beforeAll, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import {
  encryptPatient,
  decryptPatient,
  tryDecryptPatient,
  type PatientRow,
} from "@/lib/db/patient-mappers";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64");
});

describe("patient mappers (cifrado de PII)", () => {
  it("cifra los campos sensibles (no quedan en claro)", () => {
    const enc = encryptPatient({
      fullName: "Ana Gómez",
      document: "CC123456",
      phone: "3001234567",
      email: "ana@correo.co",
      notes: "Ansiedad laboral",
    });
    expect(enc.full_name_enc).not.toContain("Ana");
    expect(enc.document_enc).not.toContain("CC123");
    expect(enc.phone_enc).not.toContain("300");
    expect(enc.notes_enc).not.toContain("Ansiedad");
  });

  it("round-trip: encrypt → decrypt reconstruye los datos", () => {
    const input = {
      fullName: "Ana Gómez",
      document: "CC123456",
      phone: "3001234567",
      email: "ana@correo.co",
      notes: "Ansiedad laboral",
      birthDate: "1990-05-12",
      gender: "F",
      emergencyContactName: "Luis Gómez",
      emergencyContactPhone: "3009876543",
      emergencyContactRelationship: "Hermano",
      history: "Alergia a la penicilina.",
    };
    const enc = encryptPatient(input);
    const row: PatientRow = {
      id: "p1",
      clinic_id: "c1",
      created_at: "2026-06-23T00:00:00Z",
      ...enc,
    };
    const out = decryptPatient(row);
    expect(out).toMatchObject(input);
    expect(out.id).toBe("p1");
  });

  it("conserva null en campos opcionales vacíos", () => {
    const enc = encryptPatient({ fullName: "Solo Nombre" });
    expect(enc.document_enc).toBeNull();
    expect(enc.phone_enc).toBeNull();
    const out = decryptPatient({
      id: "p2",
      clinic_id: "c1",
      created_at: "2026-06-23T00:00:00Z",
      ...enc,
    });
    expect(out.fullName).toBe("Solo Nombre");
    expect(out.document).toBeNull();
  });
});

describe("tryDecryptPatient (tolerante a clave incorrecta)", () => {
  it("descifra normalmente cuando el cifrado es válido", () => {
    const enc = encryptPatient({ fullName: "Ana Gómez" });
    const row: PatientRow = { id: "p1", clinic_id: "c1", created_at: "2026-06-23T00:00:00Z", ...enc };
    expect(tryDecryptPatient(row)).toMatchObject({ id: "p1", fullName: "Ana Gómez" });
  });

  it("devuelve null (no lanza) si el cifrado no corresponde a la clave actual", () => {
    // Simula datos cifrados con una ENCRYPTION_KEY distinta a la vigente
    // (p. ej. tras rotar la clave sin migrar registros antiguos — el
    // incidente real que motivó esta protección).
    const otherKey = Buffer.from("b".repeat(32)).toString("base64");
    const row: PatientRow = {
      id: "p-huerfano",
      clinic_id: "c1",
      created_at: "2026-06-23T00:00:00Z",
      full_name_enc: encrypt("Paciente Antiguo", otherKey),
      document_enc: null,
      phone_enc: null,
      email_enc: null,
      notes_enc: null,
      birth_date: null,
      gender: null,
    };

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => tryDecryptPatient(row)).not.toThrow();
    expect(tryDecryptPatient(row)).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
