import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getChannelStatuses, isVideoSimulated } from "@/lib/channel-status";

const VARS = [
  "DEEPGRAM_API_KEY",
  "OPENAI_API_KEY",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "DAILY_API_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "VIDEO_PROVIDER",
  "TRANSCRIPTION_PROVIDER",
  "ANALYSIS_PROVIDER",
];

describe("estado de los canales externos", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("sin ninguna credencial, todos los canales salen como simulados", () => {
    const channels = getChannelStatuses();
    expect(channels).toHaveLength(5);
    for (const c of channels) {
      expect(c.mode).toBe("simulated");
    }
  });

  it("cada canal simulado explica qué deja de funcionar", () => {
    // Un panel que solo dijera "simulado" no le sirve a quien tiene que
    // decidir si eso importa o no.
    for (const c of getChannelStatuses()) {
      expect(c.impact.length).toBeGreaterThan(20);
      expect(c.missing.length).toBeGreaterThan(0);
    }
  });

  it("una credencial presente marca su canal como activo", () => {
    process.env.DEEPGRAM_API_KEY = "clave";
    const transcripcion = getChannelStatuses().find((c) => c.key === "transcription");
    expect(transcripcion?.mode).toBe("live");
    expect(transcripcion?.missing).toEqual([]);
  });

  it("una cadena en blanco no cuenta como configurada", () => {
    process.env.RESEND_API_KEY = "   ";
    const correo = getChannelStatuses().find((c) => c.key === "email");
    expect(correo?.missing).toContain("RESEND_API_KEY");
  });

  it("el correo exige remitente además de la clave", () => {
    process.env.RESEND_API_KEY = "clave";
    const correo = getChannelStatuses().find((c) => c.key === "email");
    expect(correo?.missing).toEqual(["EMAIL_FROM"]);
  });

  it("isVideoSimulated coincide con el estado del canal de video", () => {
    expect(isVideoSimulated()).toBe(true);
    const video = getChannelStatuses().find((c) => c.key === "video");
    expect(video?.mode).toBe("simulated");
  });

  it("VIDEO_PROVIDER=mock fuerza el modo simulado aunque haya clave", () => {
    process.env.DAILY_API_KEY = "clave";
    process.env.VIDEO_PROVIDER = "mock";
    expect(isVideoSimulated()).toBe(true);
  });
});
