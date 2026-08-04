import { describe, it, expect, beforeEach } from "vitest";
import { encrypt } from "@/lib/crypto";
import { isPhq9RiskPayload } from "@/lib/db/assessments";

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

describe("isPhq9RiskPayload", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = key;
  });

  it("returns true when PHQ-9 self-harm item is > 0", () => {
    expect(isPhq9RiskPayload("phq9", encResult([0, 0, 0, 0, 0, 0, 0, 0, 1]))).toBe(true);
    expect(isPhq9RiskPayload("phq9", encResult([0, 0, 0, 0, 0, 0, 0, 0, 3]))).toBe(true);
  });

  it("returns false when PHQ-9 self-harm item is 0", () => {
    expect(isPhq9RiskPayload("phq9", encResult([3, 3, 3, 3, 3, 3, 3, 3, 0]))).toBe(false);
  });

  it("returns false for GAD-7 regardless of answers", () => {
    expect(isPhq9RiskPayload("gad7", encResult([3, 3, 3, 3, 3, 3, 3]))).toBe(false);
  });

  it("returns false for corrupted payload", () => {
    expect(isPhq9RiskPayload("phq9", "not-valid-ciphertext")).toBe(false);
  });
});
