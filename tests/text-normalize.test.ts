import { describe, it, expect } from "vitest";
import { normalizeSearchText } from "@/lib/text-normalize";

describe("normalizeSearchText", () => {
  it("quita tildes", () => {
    expect(normalizeSearchText("Andrés")).toBe("andres");
    expect(normalizeSearchText("María Fernanda Ruiz")).toBe("maria fernanda ruiz");
  });

  it("convierte a minúsculas", () => {
    expect(normalizeSearchText("CAMILA")).toBe("camila");
  });

  it("permite que un texto sin tilde coincida con uno con tilde", () => {
    const stored = normalizeSearchText("Andrés Gómez");
    const query = normalizeSearchText("andres");
    expect(stored.includes(query)).toBe(true);
  });

  it("deja intacto el texto sin acentos", () => {
    expect(normalizeSearchText("Pedro Silva")).toBe("pedro silva");
  });
});
