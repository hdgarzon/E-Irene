import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DailyVideoProvider } from "@/lib/video/daily";

describe("DailyVideoProvider", () => {
  beforeEach(() => {
    process.env.DAILY_API_KEY = "test-key";
  });

  afterEach(() => {
    delete process.env.DAILY_API_KEY;
    vi.unstubAllGlobals();
  });

  it("createRoom nunca envía enable_recording en el body (spec §8: nunca se graba)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "apt-1-abcd1234", url: "https://x.daily.co/apt-1-abcd1234" }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await new DailyVideoProvider().createRoom("consultation-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.properties).not.toHaveProperty("enable_recording");
  });

  it("createRoom lanza si Daily.co responde 200 sin name/url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    );

    await expect(new DailyVideoProvider().createRoom("consultation-1")).rejects.toThrow(
      /sin name\/url/
    );
  });

  it("createRoom lanza si Daily.co responde con error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 500 }))
    );

    await expect(new DailyVideoProvider().createRoom("consultation-1")).rejects.toThrow(/500/);
  });

  it("createMeetingToken lanza si Daily.co responde 200 sin token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
    );

    await expect(
      new DailyVideoProvider().createMeetingToken({
        roomName: "apt-1-abcd1234",
        userName: "Doctora",
        isOwner: true,
        expiresInSeconds: 3600,
      })
    ).rejects.toThrow(/sin token/);
  });

  it("createMeetingToken devuelve el token cuando la respuesta es válida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "tok_abc" }), { status: 200 }))
    );

    const token = await new DailyVideoProvider().createMeetingToken({
      roomName: "apt-1-abcd1234",
      userName: "Paciente",
      isOwner: false,
      expiresInSeconds: 3600,
    });
    expect(token).toBe("tok_abc");
  });
});
