import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "@/lib/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("logger.info escribe JSON de una línea con level/event/timestamp", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("test.event", { clinicId: "c1" });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed).toMatchObject({ level: "info", event: "test.event", clinicId: "c1" });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("logger.warn usa console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("test.warn");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]![0] as string).level).toBe("warn");
  });

  it("logger.error usa console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test.error");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(spy.mock.calls[0]![0] as string).level).toBe("error");
  });

  it("serializa instancias de Error a { message, stack }", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test.with_error", { error: new Error("boom") });
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.error.message).toBe("boom");
    expect(typeof parsed.error.stack).toBe("string");
  });

  it("serializa errores no-Error (string/objeto) a { message }", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("test.with_string_error", { error: "algo salió mal" });
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.error).toEqual({ message: "algo salió mal" });
  });

  it("sin contexto, no incluye la clave error", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info("test.no_context");
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(parsed.error).toBeUndefined();
  });
});
