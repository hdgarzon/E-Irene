import { SUPABASE_URL, isLocalSupabase } from "./supabase-env";
import { withGatewayRetry } from "./supabase-gateway-retry";

/**
 * Antes de cada archivo de pruebas: las peticiones al Supabase local que el
 * gateway corte con 502 se reenvían (ver supabase-gateway-retry.ts).
 *
 * Sobre el fetch global y no en cada createClient: supabase-js resuelve el fetch
 * global en cada llamada, así que quedan cubiertos también los clientes que crea
 * el código de lib/ (createAdminClient) cuando lo ejercen las pruebas. Un
 * vi.stubGlobal("fetch") lo reemplaza mientras dura y vi.unstubAllGlobals() lo
 * devuelve.
 */
if (SUPABASE_URL && isLocalSupabase(SUPABASE_URL)) {
  globalThis.fetch = withGatewayRetry(globalThis.fetch, { baseUrl: SUPABASE_URL });
}
