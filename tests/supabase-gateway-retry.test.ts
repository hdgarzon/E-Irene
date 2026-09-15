import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { isLocalSupabase } from "./helpers/supabase-env";
import { isGatewayRetryFetch, withGatewayRetry } from "./helpers/supabase-gateway-retry";

/**
 * Reintento de los 502 del gateway del Supabase local
 * (tests/helpers/supabase-gateway-retry.ts).
 *
 * Sin stack: todo con un fetch simulado. Lo que se comprueba es que un 502 de
 * Kong —la petición nunca llegó a PostgREST— no le llegue a la prueba como si
 * fuera la respuesta de la base, y que no se reintente nada más.
 */

const LOCAL = "http://127.0.0.1:54321";
const SIN_ESPERA = { baseUrl: LOCAL, delayMs: 0 };

/** Lo que responde Kong 2.8.1 cuando PostgREST le cierra la conexión (kong/error_handlers.lua). */
function kong502(): Response {
  return new Response(
    JSON.stringify({ message: "An invalid response was received from the upstream server" }),
    { status: 502, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

describe("reintento de los 502 del gateway del Supabase local", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("un envío que Kong cortó con 502 se reenvía y la prueba ve el P0001 del trigger", async () => {
    const base = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(kong502())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "P0001",
            message: "Las rutas de los documentos tienen que ser de tu propia carpeta",
            details: null,
            hint: null,
          }),
          { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
        ),
      );
    const client = createClient(LOCAL, "sb_publishable_test", {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: withGatewayRetry(base, SIN_ESPERA) },
    });

    const { error } = await client
      .from("users")
      .update({ verification_status: "pending_review" })
      .eq("id", "00000000-0000-0000-0000-000000000001");

    expect(error?.code).toBe("P0001");
    expect(base).toHaveBeenCalledTimes(2);
    const [primero, segundo] = base.mock.calls;
    expect(String(segundo[0])).toBe(String(primero[0]));
    expect(segundo[1]?.method).toBe("PATCH");
    expect(segundo[1]?.body).toBe(primero[1]?.body);
    // Cada reintento se registra: el reenvío no pasa en silencio.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("no reintenta lo que sí respondieron PostgREST, Auth o Storage", async () => {
    for (const status of [200, 204, 400, 401, 403, 404, 409, 500, 503, 504]) {
      const base = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
      const res = await withGatewayRetry(base, SIN_ESPERA)(`${LOCAL}/rest/v1/users`, {
        method: "PATCH",
        body: "{}",
      });
      expect(res.status, String(status)).toBe(status);
      expect(base, String(status)).toHaveBeenCalledTimes(1);
    }
  });

  it("no toca las peticiones a otros servicios", async () => {
    const base = vi.fn<typeof fetch>().mockImplementation(async () => kong502());
    const res = await withGatewayRetry(base, SIN_ESPERA)("https://api.example.com/v1/charges", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(502);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("con el gateway caído se rinde y devuelve el 502: la prueba sigue fallando", async () => {
    const base = vi.fn<typeof fetch>().mockImplementation(async () => kong502());
    const res = await withGatewayRetry(base, { ...SIN_ESPERA, maxRetries: 2 })(
      `${LOCAL}/rest/v1/users`,
      { method: "PATCH", body: "{}" },
    );
    expect(res.status).toBe(502);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("no reenvía un cuerpo que ya se consumió", async () => {
    const base = vi.fn<typeof fetch>().mockImplementation(async () => kong502());
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const res = await withGatewayRetry(base, SIN_ESPERA)(
      `${LOCAL}/storage/v1/object/professional-docs/archivo.pdf`,
      { method: "POST", body },
    );
    expect(res.status).toBe(502);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("no se envuelve dos veces: cada 502 recibe una sola tanda de reintentos", () => {
    const base = vi.fn<typeof fetch>();
    const envuelto = withGatewayRetry(base, SIN_ESPERA);
    expect(withGatewayRetry(envuelto, SIN_ESPERA)).toBe(envuelto);
  });

  it.skipIf(!isLocalSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL))(
    "con un Supabase local, la configuración de vitest lo instala en el fetch global",
    () => {
      expect(isGatewayRetryFetch(globalThis.fetch)).toBe(true);
    },
  );
});
