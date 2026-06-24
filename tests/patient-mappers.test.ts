import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptPatient,
  decryptPatient,
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
    };
    const enc = encryptPatient(input);
    const row: PatientRow = {
      id: "p1",
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
      created_at: "2026-06-23T00:00:00Z",
      ...enc,
    });
    expect(out.fullName).toBe("Solo Nombre");
    expect(out.document).toBeNull();
  });
});
