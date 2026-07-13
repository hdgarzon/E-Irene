import { describe, it, expect } from "vitest";
import { MockVideoProvider } from "@/lib/video/mock";

describe("MockVideoProvider", () => {
  it("mode es 'mock'", () => {
    expect(new MockVideoProvider().mode).toBe("mock");
  });

  it("createRoom devuelve un roomName único y una roomUrl con ese nombre, sin red", async () => {
    const provider = new MockVideoProvider();
    const a = await provider.createRoom("consultation-1");
    const b = await provider.createRoom("consultation-2");
    expect(a.roomName).not.toBe(b.roomName);
    expect(a.roomUrl).toContain(a.roomName);
  });

  it("deleteRoom no lanza (no-op)", async () => {
    const provider = new MockVideoProvider();
    await expect(provider.deleteRoom("cualquier-sala")).resolves.toBeUndefined();
  });
});
