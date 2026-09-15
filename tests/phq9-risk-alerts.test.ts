import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { isPhq9SelfHarmPayload } from "@/lib/db/assessments";

const key = Buffer.from("a".repeat(32)).toString("base64");

function encResult(answers: number[]) {
  return encrypt(
    JSON.stringify({
      answers,
      totalScore: answers.reduce((sum, a) => sum + a, 0),
      severity: "test",
    }),
    key,
  );
}

describe("isPhq9SelfHarmPayload", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", key);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true when PHQ-9 self-harm item is > 0", () => {
    expect(isPhq9SelfHarmPayload("phq9", encResult([0, 0, 0, 0, 0, 0, 0, 0, 1]))).toBe(true);
    expect(isPhq9SelfHarmPayload("phq9", encResult([0, 0, 0, 0, 0, 0, 0, 0, 3]))).toBe(true);
  });

  it("returns false when PHQ-9 self-harm item is 0", () => {
    expect(isPhq9SelfHarmPayload("phq9", encResult([3, 3, 3, 3, 3, 3, 3, 3, 0]))).toBe(false);
  });

  it("returns false for GAD-7 regardless of answers", () => {
    expect(isPhq9SelfHarmPayload("gad7", encResult([3, 3, 3, 3, 3, 3, 3]))).toBe(false);
  });

  // Antes devolvía false: un PHQ-9 ilegible pasaba por "sin riesgo" y su
  // alerta desaparecía sin rastro.
  it("throws for a corrupted payload instead of reporting no risk", () => {
    expect(() => isPhq9SelfHarmPayload("phq9", "not-valid-ciphertext")).toThrow();
  });

  it("throws when the payload decrypts but has no answers", () => {
    expect(() => isPhq9SelfHarmPayload("phq9", encrypt(JSON.stringify({ totalScore: 3 }), key))).toThrow();
  });
});
