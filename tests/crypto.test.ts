import { describe, it, expect, vi } from "vitest";
import { encrypt, decrypt, assertEncryptionKey } from "@/lib/crypto";

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

  it("assertEncryptionKey fails loudly on a missing or malformed key", () => {
    expect(() => assertEncryptionKey(key)).not.toThrow();
    expect(() => assertEncryptionKey(Buffer.from("short").toString("base64"))).toThrow();
    vi.stubEnv("ENCRYPTION_KEY", "");
    try {
      expect(() => assertEncryptionKey()).toThrow("ENCRYPTION_KEY no está configurada");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("llavero de claves (rotación)", () => {
  const k1 = Buffer.from("1".repeat(32)).toString("base64");
  const k2 = Buffer.from("2".repeat(32)).toString("base64");

  function withEnv(env: Record<string, string | undefined>, fn: () => void) {
    const keys = ["ENCRYPTION_KEY", "ENCRYPTION_KEY_ID", "ENCRYPTION_KEY_NEXT", "ENCRYPTION_KEY_NEXT_ID", "ENCRYPTION_KEYS_RETIRED"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const k of keys) {
        if (env[k] === undefined) delete process.env[k];
        else process.env[k] = env[k];
      }
      fn();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it("sin configuración nueva, todo queda igual: clave 1 y formato sin prefijo", async () => {
    const { activeKeyId, keyIdOf } = await import("@/lib/crypto");
    withEnv({ ENCRYPTION_KEY: k1 }, () => {
      const ct = encrypt("Paciente Demo");
      expect(ct).not.toMatch(/^k\d+:/);
      expect(activeKeyId()).toBe("1");
      expect(keyIdOf(ct)).toBe("1");
      expect(decrypt(ct)).toBe("Paciente Demo");
    });
  });

  it("durante la rotación, ENCRYPTION_KEY_NEXT es la activa y ENCRYPTION_KEY queda para descifrar", async () => {
    const { activeKeyId } = await import("@/lib/crypto");
    let legacy = "";
    withEnv({ ENCRYPTION_KEY: k1 }, () => {
      legacy = encrypt("Paciente Demo");
    });
    withEnv({ ENCRYPTION_KEY: k1, ENCRYPTION_KEY_NEXT: k2, ENCRYPTION_KEY_NEXT_ID: "2" }, () => {
      expect(activeKeyId()).toBe("2");
      const ct = encrypt("Paciente Demo");
      expect(ct.startsWith("k2:")).toBe(true);
      expect(decrypt(ct)).toBe("Paciente Demo");
      expect(decrypt(legacy)).toBe("Paciente Demo");
    });
    // Terminada: la nueva pasa a ENCRYPTION_KEY con su id, sin la anterior.
    withEnv({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: "2" }, () => {
      expect(() => decrypt(legacy)).toThrow(/no está en el llavero/);
    });
    withEnv({ ENCRYPTION_KEY: k1, ENCRYPTION_KEY_NEXT: k2, ENCRYPTION_KEY_NEXT_ID: "1" }, () => {
      expect(() => assertEncryptionKey()).toThrow(/distinto/);
    });
  });

  it("con la clave 2 activa cifra con prefijo y sigue leyendo lo de la 1 con el llavero", async () => {
    const { keyIdOf } = await import("@/lib/crypto");
    let legacy = "";
    withEnv({ ENCRYPTION_KEY: k1 }, () => {
      legacy = encrypt("Paciente Demo");
    });
    withEnv({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: "2", ENCRYPTION_KEYS_RETIRED: `1:${k1}` }, () => {
      const ct = encrypt("Paciente Demo");
      expect(ct.startsWith("k2:")).toBe(true);
      expect(keyIdOf(ct)).toBe("2");
      expect(decrypt(ct)).toBe("Paciente Demo");
      expect(decrypt(legacy)).toBe("Paciente Demo");
    });
  });

  it("sin la clave retirada en el llavero, lo viejo falla con un mensaje claro", () => {
    let legacy = "";
    withEnv({ ENCRYPTION_KEY: k1 }, () => {
      legacy = encrypt("x");
    });
    withEnv({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: "2" }, () => {
      expect(() => decrypt(legacy)).toThrow(/clave de cifrado 1 no está en el llavero/);
    });
  });

  it("rechaza un llavero mal formado", () => {
    withEnv({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: "2", ENCRYPTION_KEYS_RETIRED: "uno:abc" }, () => {
      expect(() => assertEncryptionKey()).toThrow(/id:clave/);
    });
    withEnv({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: "2", ENCRYPTION_KEYS_RETIRED: `2:${k1}` }, () => {
      expect(() => assertEncryptionKey()).toThrow(/dos veces/);
    });
    withEnv({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: "dos" }, () => {
      expect(() => assertEncryptionKey()).toThrow(/número/);
    });
  });
});
