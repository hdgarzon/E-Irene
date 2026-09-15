import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Contrato de /api/webhooks/daily: cuándo descuenta y cuándo no. El descuento real
// (una vez por consulta, reservas) lo prueba video-credits.test.ts contra la base.

const findVideoConsultationForRoom = vi.fn();
const consumeVideoCall = vi.fn();
vi.mock("@/lib/db/video-credits", () => ({
  findVideoConsultationForRoom: (...a: unknown[]) => findVideoConsultationForRoom(...a),
  consumeVideoCall: (...a: unknown[]) => consumeVideoCall(...a),
}));

const { POST } = await import("@/app/api/webhooks/daily/route");
const { computeDailySignature } = await import("@/lib/video/daily-webhook");
const { doctorVideoUserId, patientVideoUserId } = await import("@/lib/video/participant-id");
const { logger } = await import("@/lib/logger");

const SECRET = Buffer.from("secreto-de-prueba-daily").toString("base64");
const APPOINTMENT = "3f0c2a4e-8b1d-4c6e-9a7f-1b2c3d4e5f60";
const CONSULTATION = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const CLINIC = "6550747c-13a0-4cfb-a88a-b1cb9bb99952";
const ROOM = "apt-demo-sala";
const JOINED_AT = 1_789_000_000;

function joined(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    version: "1.0.0",
    type: "participant.joined",
    id: "evt-demo-1",
    event_ts: JOINED_AT + 1,
    payload: {
      room: ROOM,
      user_id: userId,
      user_name: "Paciente Demo",
      session_id: "sesion-demo",
      joined_at: JOINED_AT,
      owner: false,
    },
    ...overrides,
  };
}

function request(
  event: unknown,
  options: { secret?: string; signature?: string | null; body?: string } = {},
): Request {
  const signedBody = JSON.stringify(event);
  const timestamp = String(JOINED_AT + 2);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-webhook-timestamp": timestamp,
  };
  const signature =
    options.signature === undefined
      ? computeDailySignature({ timestamp, body: signedBody, secret: options.secret ?? SECRET })
      : options.signature;
  if (signature !== null) headers["x-webhook-signature"] = signature;
  return new Request("https://e-irene.co/api/webhooks/daily", {
    method: "POST",
    headers,
    body: options.body ?? signedBody,
  });
}

const original = process.env.DAILY_WEBHOOK_HMAC;

beforeEach(() => {
  process.env.DAILY_WEBHOOK_HMAC = SECRET;
  findVideoConsultationForRoom
    .mockReset()
    .mockResolvedValue({ consultationId: CONSULTATION, clinicId: CLINIC });
  consumeVideoCall.mockReset().mockResolvedValue("consumed");
});

afterEach(() => {
  if (original === undefined) delete process.env.DAILY_WEBHOOK_HMAC;
  else process.env.DAILY_WEBHOOK_HMAC = original;
  vi.restoreAllMocks();
});

describe("webhook de Daily", () => {
  it("sin DAILY_WEBHOOK_HMAC responde 503 y no procesa nada", async () => {
    delete process.env.DAILY_WEBHOOK_HMAC;
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const res = await POST(request(joined(patientVideoUserId(APPOINTMENT))));
    expect(res.status).toBe(503);
    expect(consumeVideoCall).not.toHaveBeenCalled();
  });

  it("responde 200 al ping de verificación sin procesarlo", async () => {
    const res = await POST(request({ test: "test" }, { signature: null }));
    expect(res.status).toBe(200);
    expect(findVideoConsultationForRoom).not.toHaveBeenCalled();
  });

  it("SEGURIDAD: una firma con otro secreto o sin firma responde 401 y no descuenta", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const event = joined(patientVideoUserId(APPOINTMENT));
    const otherSecret = Buffer.from("otro-secreto").toString("base64");

    expect((await POST(request(event, { secret: otherSecret }))).status).toBe(401);
    expect((await POST(request(event, { signature: null }))).status).toBe(401);
    expect(consumeVideoCall).not.toHaveBeenCalled();
  });

  it("SEGURIDAD: un cuerpo alterado después de firmar responde 401", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    const event = joined(patientVideoUserId(APPOINTMENT));
    const tampered = JSON.stringify(joined(patientVideoUserId(APPOINTMENT), { id: "evt-otro" }));
    const res = await POST(request(event, { body: tampered }));
    expect(res.status).toBe(401);
    expect(consumeVideoCall).not.toHaveBeenCalled();
  });

  it("la conexión del paciente descuenta la videollamada de su consulta", async () => {
    vi.spyOn(logger, "info").mockImplementation(() => {});
    const res = await POST(request(joined(patientVideoUserId(APPOINTMENT))));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, result: "consumed" });
    expect(findVideoConsultationForRoom).toHaveBeenCalledWith({
      appointmentId: APPOINTMENT,
      roomName: ROOM,
      joinedAt: new Date(JOINED_AT * 1000),
    });
    expect(consumeVideoCall).toHaveBeenCalledWith({
      consultationId: CONSULTATION,
      source: "webhook:evt-demo-1",
      joinedAt: new Date(JOINED_AT * 1000).toISOString(),
    });
  });

  it("la conexión del profesional no descuenta", async () => {
    const res = await POST(request(joined(doctorVideoUserId(CLINIC))));
    expect(res.status).toBe(200);
    expect(findVideoConsultationForRoom).not.toHaveBeenCalled();
    expect(consumeVideoCall).not.toHaveBeenCalled();
  });

  it("un participante sin user_id de esta app no descuenta", async () => {
    const res = await POST(request(joined("usuario-externo")));
    expect(res.status).toBe(200);
    expect(consumeVideoCall).not.toHaveBeenCalled();
  });

  it("otros eventos se acusan sin procesar", async () => {
    const res = await POST(
      request(joined(patientVideoUserId(APPOINTMENT), { type: "participant.left" })),
    );
    expect(res.status).toBe(200);
    expect(consumeVideoCall).not.toHaveBeenCalled();
  });

  it("si la sala no es la de la cita, no descuenta", async () => {
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    findVideoConsultationForRoom.mockResolvedValue(null);
    const res = await POST(request(joined(patientVideoUserId(APPOINTMENT))));
    expect(res.status).toBe(200);
    expect(consumeVideoCall).not.toHaveBeenCalled();
  });

  it("si descontar falla responde 200 igual (Daily apaga el webhook tras 3 fallos) y lo registra", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    consumeVideoCall.mockRejectedValue(new Error("conexión perdida"));

    const res = await POST(request(joined(patientVideoUserId(APPOINTMENT))));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ deferred: true });
    expect(errors.mock.calls.some(([event]) => event === "daily_webhook.consume_failed")).toBe(true);
  });
});
