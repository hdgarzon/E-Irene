import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isRetryableStatus, computeBackoffMs, fetchWithRetry } from "@/lib/providers/openai";

function jsonResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({}), { status, headers });
}

describe("isRetryableStatus", () => {
  it("429 (rate limit) y 5xx son transitorios — reintentables", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("un 4xx que no sea 429 es un problema del request — no se reintenta", () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe("computeBackoffMs", () => {
  it("respeta el header Retry-After si viene presente", () => {
    expect(computeBackoffMs(0, "5")).toBe(5000);
  });

  it("cap el Retry-After a un máximo razonable en vez de esperar lo que sea que pida el servidor", () => {
    expect(computeBackoffMs(0, "999")).toBeLessThanOrEqual(20_000);
  });

  it("un Retry-After inválido (no numérico) cae al backoff exponencial", () => {
    const delay = computeBackoffMs(0, "not-a-number");
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThan(2000);
  });

  it("sin Retry-After, crece exponencialmente con cada intento (con jitter acotado)", () => {
    const attempt0 = computeBackoffMs(0, null);
    const attempt1 = computeBackoffMs(1, null);
    const attempt2 = computeBackoffMs(2, null);
    expect(attempt0).toBeGreaterThanOrEqual(1000);
    expect(attempt0).toBeLessThan(2000);
    expect(attempt1).toBeGreaterThanOrEqual(2000);
    expect(attempt1).toBeLessThan(3000);
    expect(attempt2).toBeGreaterThanOrEqual(4000);
    expect(attempt2).toBeLessThan(5000);
  });
});

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("un éxito en el primer intento no reintenta", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200));
    const res = await fetchWithRetry("https://example.com", {}, fetchImpl);
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("un 4xx no-429 se devuelve de inmediato, sin reintentar", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400));
    const res = await fetchWithRetry("https://example.com", {}, fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("un 429 seguido de éxito se recupera solo, sin que el caller vea el error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithRetry("https://example.com", {}, fetchImpl);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("tras agotar los reintentos con 429 persistente, devuelve la última respuesta fallida (no lanza)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429));
    const promise = fetchWithRetry("https://example.com", {}, fetchImpl);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // intento inicial + 3 reintentos
  });

  it("un fallo de red (fetch lanza) también se reintenta y puede recuperarse", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200));

    const promise = fetchWithRetry("https://example.com", {}, fetchImpl);
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("si TODOS los intentos son fallos de red, relanza el último error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const promise = fetchWithRetry("https://example.com", {}, fetchImpl);
    // El handler debe engancharse ANTES de avanzar los timers: si `promise`
    // rechaza durante `runAllTimersAsync()` sin nadie escuchando todavía,
    // Node lo reporta como unhandled rejection aunque lo atrapemos justo
    // después — es una carrera del test, no del código bajo prueba.
    const assertion = expect(promise).rejects.toThrow("fetch failed");
    await vi.runAllTimersAsync();

    await assertion;
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
