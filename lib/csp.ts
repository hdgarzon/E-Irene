/**
 * Orígenes del Supabase configurado que el navegador necesita en connect-src.
 *
 * La CSP de proxy.ts ya permite https://*.supabase.co, que cubre producción. En
 * local la URL es http://127.0.0.1:54321 y quedaba fuera: el navegador bloqueaba
 * toda llamada directa a Supabase —la subida de documentos de verificación, por
 * ejemplo— sin llegar a enviarla, así que esos flujos no se podían probar en
 * desarrollo ni en los e2e de CI. Se agrega solo el origen configurado y su
 * WebSocket (Realtime), nunca un comodín.
 */
export function supabaseConnectSources(supabaseUrl: string | undefined): string[] {
  if (!supabaseUrl) return [];
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  const socket = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  return [url.origin, socket];
}
