/**
 * Reenvía las peticiones al Supabase local que el gateway (Kong) cortó con 502.
 *
 * POR QUÉ EXISTE
 *   El 2026-09-14 rls.test.ts falló una vez en "un envío a revisión NO acepta
 *   rutas de la carpeta de otro profesional" con `expected undefined to be
 *   'P0001'`. No fallaba el control: la petición nunca llegó a la base.
 *
 *   · Kong registró ese PATCH con 502 ("upstream prematurely closed connection
 *     while reading response header from upstream"). PostgREST cierra las
 *     conexiones que quedan ociosas —en su log, "Warp server error: Thread
 *     killed by timeout manager"— y Kong a veces reutiliza una justo cuando se
 *     cierra.
 *   · La fila quedó intacta y Postgres no registró el raise del trigger, que sí
 *     quedó en las demás corridas registradas de esa prueba.
 *   · Kong no reintenta PATCH ni POST, y postgrest-js solo reintenta GET, HEAD y
 *     OPTIONS ante 503 o 520. El cuerpo del 502 ({"message": …}) no trae `code`:
 *     la prueba ve un error sin código.
 *
 *   No depende de la prueba: esa misma noche Kong cortó también un PATCH a
 *   clinics y un POST a una RPC. Y el corte engaña en los dos sentidos: hace
 *   fallar una aserción sobre el código y hace pasar un
 *   `expect(error).not.toBeNull()` sin que la base haya decidido nada.
 *
 * QUÉ REINTENTA, Y QUÉ NO
 *   Solo un 502 de una petición al origen de NEXT_PUBLIC_SUPABASE_URL cuyo
 *   cuerpo se pueda volver a enviar. En este stack el 502 lo pone Kong cuando
 *   no obtiene respuesta del servicio; una decisión de RLS, de un grant o de un
 *   trigger llega de PostgREST como 4xx, nunca como 502. Cualquier otra
 *   respuesta —un 4xx, un 500, un 503 de PostgREST, un 504 de Auth— llega tal
 *   cual. Agotados los reintentos se devuelve el 502: con el gateway caído la
 *   prueba sigue fallando. Cada reintento se registra con console.warn; vitest
 *   no muestra la consola de las pruebas que pasan cuando la salida no es una
 *   terminal, pero el 502 queda igual en el log de Kong.
 */

const MARK = Symbol.for("e-irene.tests.gatewayRetry");

export interface GatewayRetryOptions {
  /** URL del Supabase local: solo se reintentan las peticiones a su origen. */
  baseUrl: string;
  /** Reintentos después del primer intento. */
  maxRetries?: number;
  /** Espera antes del reintento n: delayMs × n. */
  delayMs?: number;
}

export function isGatewayRetryFetch(fn: unknown): boolean {
  return typeof fn === "function" && MARK in fn;
}

export function withGatewayRetry(
  baseFetch: typeof fetch,
  { baseUrl, maxRetries = 2, delayMs = 100 }: GatewayRetryOptions,
): typeof fetch {
  // Envolver dos veces multiplicaría los intentos de cada 502.
  if (isGatewayRetryFetch(baseFetch)) return baseFetch;
  const origin = new URL(baseUrl).origin;

  const fetchWithRetry = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let res = await baseFetch(input, init);
    const url = requestUrl(input);
    if (res.status !== 502 || !url || url.origin !== origin || !replayableBody(init?.body)) {
      return res;
    }

    for (let attempt = 1; attempt <= maxRetries && res.status === 502; attempt++) {
      await res.body?.cancel();
      console.warn(
        `[supabase local] ${init?.method ?? "GET"} ${url.pathname}: 502 del gateway, ` +
          `reintento ${attempt}/${maxRetries}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      res = await baseFetch(input, init);
    }
    return res;
  };

  return Object.assign(fetchWithRetry, { [MARK]: true });
}

/** URL de la petición, o null si llega como Request: su cuerpo lo leyó el primer envío. */
function requestUrl(input: RequestInfo | URL): URL | null {
  if (input instanceof Request) return null;
  try {
    return new URL(String(input));
  } catch {
    return null;
  }
}

/** Un stream se consume al enviarlo; estos cuerpos se pueden volver a mandar. */
function replayableBody(body: RequestInit["body"]): boolean {
  return (
    body == null ||
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}
