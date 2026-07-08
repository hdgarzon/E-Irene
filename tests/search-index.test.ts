import { describe, it, expect, beforeAll } from "vitest";
import { computeTrigrams, isSearchableQuery, patientSearchText, MIN_QUERY_LENGTH } from "@/lib/search-index";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString("base64");
});

describe("isSearchableQuery", () => {
  it("false para menos de 3 caracteres normalizados", () => {
    expect(isSearchableQuery("")).toBe(false);
    expect(isSearchableQuery("an")).toBe(false);
    expect(isSearchableQuery("  an  ")).toBe(false);
  });

  it("true desde 3 caracteres", () => {
    expect(isSearchableQuery("ana")).toBe(true);
    expect(isSearchableQuery("Ana")).toBe(true);
  });
});

describe("computeTrigrams", () => {
  it("no genera trigramas para texto corto", () => {
    expect(computeTrigrams("an")).toEqual([]);
    expect(computeTrigrams("")).toEqual([]);
  });

  it("es determinista: mismo texto → mismos hashes", () => {
    const a = computeTrigrams("Ana Gómez");
    const b = computeTrigrams("Ana Gómez");
    expect(a.sort()).toEqual(b.sort());
  });

  it("es insensible a mayúsculas y tildes (normaliza antes de hashear)", () => {
    const a = computeTrigrams("Andrés");
    const b = computeTrigrams("andres");
    // "andres" comparte todos sus trigramas con la versión normalizada de "Andrés".
    expect(a.every((t) => b.includes(t))).toBe(true);
  });

  it("nunca expone el texto en claro (son hashes hex de 64 caracteres)", () => {
    const trigrams = computeTrigrams("Ana Gómez 123456");
    for (const t of trigrams) {
      expect(t).toMatch(/^[0-9a-f]{64}$/);
      expect(t).not.toContain("ana");
      expect(t).not.toContain("gomez");
    }
  });

  it("textos distintos producen conjuntos de trigramas distintos", () => {
    const a = computeTrigrams("Ana Gómez");
    const b = computeTrigrams("Luis Torres");
    expect(a).not.toEqual(b);
  });

  it("dos nombres que comparten un fragmento comparten al menos un trigrama (permite el overlap match)", () => {
    const a = computeTrigrams("Ana Gonzalez");
    const b = computeTrigrams("Pedro Gonzalez");
    const shared = a.filter((t) => b.includes(t));
    expect(shared.length).toBeGreaterThan(0);
  });

  it(`MIN_QUERY_LENGTH es ${MIN_QUERY_LENGTH}`, () => {
    expect(MIN_QUERY_LENGTH).toBe(3);
  });
});

describe("patientSearchText", () => {
  it("combina nombre, documento y teléfono", () => {
    expect(patientSearchText({ fullName: "Ana Gómez", document: "123", phone: "300" })).toBe(
      "Ana Gómez 123 300",
    );
  });

  it("tolera document/phone ausentes", () => {
    expect(patientSearchText({ fullName: "Ana Gómez" })).toBe("Ana Gómez  ");
  });
});
