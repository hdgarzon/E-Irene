import { describe, it, expect } from "vitest";
import { generatePatientLinkToken, patientLinkExpiryDate, buildPatientLinkUrl } from "@/lib/patient-links";
import { sha256 } from "@/lib/consent";

describe("generatePatientLinkToken", () => {
  it("returns a token whose hash matches tokenHash", () => {
    const { token, tokenHash } = generatePatientLinkToken();
    expect(sha256(token)).toBe(tokenHash);
  });

  it("generates a different token each call", () => {
    const a = generatePatientLinkToken();
    const b = generatePatientLinkToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("generates a URL-safe token with no padding characters", () => {
    const { token } = generatePatientLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("patientLinkExpiryDate", () => {
  it("expires 7 days after the given date", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    const expiry = patientLinkExpiryDate(from);
    expect(expiry.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
});

describe("buildPatientLinkUrl", () => {
  it("builds an absolute /enlace/<token> URL using NEXT_PUBLIC_APP_URL", () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://e-irene.co";
    expect(buildPatientLinkUrl("abc123")).toBe("https://e-irene.co/enlace/abc123");
    process.env.NEXT_PUBLIC_APP_URL = original;
  });
});
