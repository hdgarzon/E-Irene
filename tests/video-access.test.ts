import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

// Estas reglas no tocan la base: se aíslan los módulos que la leen.
vi.mock("@/lib/db/clinic", () => ({ getClinicSubscription: vi.fn() }));
vi.mock("@/lib/db/video-credits", () => ({}));

const {
  PLANS,
  VIDEO_CALL_PRICE_IN_CENTS,
  VIDEO_PACK_SIZES,
  isVideoPackSize,
  videoPackPriceInCents,
} = await import("@/lib/plans");
const { VIDEO_GATE_MESSAGES, videoPackAvailability } = await import("@/lib/billing/video-access");
const { doctorVideoUserId, parseVideoUserId, patientVideoUserId } = await import(
  "@/lib/video/participant-id"
);
const { computeDailySignature, isDailyVerificationPing, verifyDailySignature } = await import(
  "@/lib/video/daily-webhook"
);

// Videollamadas por plan, packs e identidad en Daily (migración 0058). Lo que la base
// otorga, reserva y descuenta: video-credits.test.ts.

const APPOINTMENT = "3f0c2a4e-8b1d-4c6e-9a7f-1b2c3d4e5f60";
const USER = "0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3";

describe("videollamadas por plan", () => {
  it("Free no tiene, los planes pagos las compran y Enterprise las incluye", () => {
    expect(PLANS.free.video).toBe("none");
    expect(PLANS.esencial.video).toBe("addon");
    expect(PLANS.pro.video).toBe("addon");
    expect(PLANS.clinica.video).toBe("addon");
    expect(PLANS.enterprise.video).toBe("included");
  });

  it("packs de 1, 5 y 10 a $9.000 cada videollamada", () => {
    expect(VIDEO_CALL_PRICE_IN_CENTS).toBe(900_000);
    expect(VIDEO_PACK_SIZES).toEqual([1, 5, 10]);
    expect(VIDEO_PACK_SIZES.map(videoPackPriceInCents)).toEqual([900_000, 4_500_000, 9_000_000]);
    expect(isVideoPackSize(5)).toBe(true);
    expect(isVideoPackSize(3)).toBe(false);
  });

  it("los packs se venden solo a planes con video como adicional y período vigente", () => {
    expect(videoPackAvailability({ plan: "pro", hasPaidPeriod: true })).toBe("available");
    expect(videoPackAvailability({ plan: "pro", hasPaidPeriod: false })).toBe("not_eligible");
    expect(videoPackAvailability({ plan: "free", hasPaidPeriod: true })).toBe("not_eligible");
    expect(videoPackAvailability({ plan: "enterprise", hasPaidPeriod: true })).toBe("not_eligible");
  });

  it("el aviso del gate nombra el plan", () => {
    expect(VIDEO_GATE_MESSAGES.plan("Free")).toContain("El plan Free no incluye videollamadas");
  });
});

describe("identidad en la sala de Daily", () => {
  it("el paciente y el profesional se distinguen por el user_id de su token", () => {
    expect(parseVideoUserId(patientVideoUserId(APPOINTMENT))).toEqual({
      kind: "patient",
      appointmentId: APPOINTMENT,
    });
    expect(parseVideoUserId(doctorVideoUserId(USER))).toEqual({ kind: "doctor", userId: USER });
  });

  it("cabe en el límite de 36 caracteres de Daily", () => {
    expect(patientVideoUserId(APPOINTMENT).length).toBeLessThanOrEqual(36);
    expect(doctorVideoUserId(USER).length).toBeLessThanOrEqual(36);
  });

  it("un user_id que no emitió esta app no identifica a nadie", () => {
    expect(parseVideoUserId(null)).toBeNull();
    expect(parseVideoUserId("")).toBeNull();
    expect(parseVideoUserId("user-123")).toBeNull();
    expect(parseVideoUserId(`x-${APPOINTMENT.replace(/-/g, "")}`)).toBeNull();
    expect(() => patientVideoUserId("no-es-un-uuid")).toThrow();
  });
});

describe("firma de los webhooks de Daily", () => {
  // Vector del algoritmo que documenta Daily, calculado con node:crypto y no con el
  // código de la app. Coincide con openssl:
  //   printf '%s' "$TS.$BODY" | openssl dgst -sha256 -mac HMAC -macopt hexkey:<secreto> -binary | base64
  // Secreto y firma se derivan aquí en vez de escribirse literales: son ficticios, pero
  // un literal base64 de alta entropía dispara el detector de secretos del repositorio.
  const RAW_SECRET = "secreto-vector-daily";
  const SECRET = Buffer.from(RAW_SECRET).toString("base64");
  const TIMESTAMP = "1789000000";
  const BODY =
    '{"version":"1.0.0","type":"participant.joined","id":"evt-vector","payload":{"room":"apt-demo","user_id":"p-00000000000040008000000000000001"}}';
  const SIGNATURE = createHmac("sha256", RAW_SECRET).update(`${TIMESTAMP}.${BODY}`).digest("base64");

  it("coincide con HMAC-SHA256 calculado aparte, sobre timestamp.cuerpo y con el secreto en base64", () => {
    expect(SIGNATURE).toHaveLength(44);
    expect(computeDailySignature({ timestamp: TIMESTAMP, body: BODY, secret: SECRET })).toBe(SIGNATURE);
    expect(
      verifyDailySignature({ timestamp: TIMESTAMP, signature: SIGNATURE, body: BODY, secret: SECRET }),
    ).toBe(true);
  });

  it("rechaza otro secreto, otro cuerpo, otra hora o cabeceras faltantes", () => {
    const otherSecret = Buffer.from("otro-secreto").toString("base64");
    expect(
      verifyDailySignature({ timestamp: TIMESTAMP, signature: SIGNATURE, body: BODY, secret: otherSecret }),
    ).toBe(false);
    expect(
      verifyDailySignature({
        timestamp: TIMESTAMP,
        signature: SIGNATURE,
        body: BODY.replace("apt-demo", "apt-otra"),
        secret: SECRET,
      }),
    ).toBe(false);
    expect(
      verifyDailySignature({ timestamp: "1789000001", signature: SIGNATURE, body: BODY, secret: SECRET }),
    ).toBe(false);
    expect(verifyDailySignature({ timestamp: null, signature: SIGNATURE, body: BODY, secret: SECRET })).toBe(
      false,
    );
    expect(verifyDailySignature({ timestamp: TIMESTAMP, signature: null, body: BODY, secret: SECRET })).toBe(
      false,
    );
  });

  it("acepta el mismo evento con otro formato de JSON, firmado como JSON.stringify", () => {
    const pretty = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(
      verifyDailySignature({ timestamp: TIMESTAMP, signature: SIGNATURE, body: pretty, secret: SECRET }),
    ).toBe(true);
  });

  it("reconoce el ping de verificación", () => {
    expect(isDailyVerificationPing({ test: "test" })).toBe(true);
    expect(isDailyVerificationPing({ type: "participant.joined" })).toBe(false);
    expect(isDailyVerificationPing(null)).toBe(false);
  });
});
