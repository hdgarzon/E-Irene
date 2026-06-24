import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

const key = Buffer.from("a".repeat(32)).toString("base64"); // 32 bytes

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a string", () => {
    const ct = encrypt("Juan Pérez", key);
    expect(ct).not.toContain("Juan");
    expect(decrypt(ct, key)).toBe("Juan Pérez");
  });

  it("produces different ciphertext each call (random IV)", () => {
    expect(encrypt("x", key)).not.toBe(encrypt("x", key));
  });

  it("throws on tampered ciphertext", () => {
    const ct = encrypt("secreto", key);
    const tampered = ct.slice(0, -3) + (ct.endsWith("AAA") ? "BBB" : "AAA");
    expect(() => decrypt(tampered, key)).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encrypt("x", Buffer.from("short").toString("base64"))).toThrow();
  });

  it("handles unicode and empty strings", () => {
    expect(decrypt(encrypt("", key), key)).toBe("");
    expect(decrypt(encrypt("áéí😀ñ", key), key)).toBe("áéí😀ñ");
  });
});
