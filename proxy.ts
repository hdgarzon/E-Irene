import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * proxy.ts (Next.js 16; reemplaza a middleware.ts).
 * Refresca la sesión de Supabase en cada request, protege las rutas de la app
 * y genera el nonce de la Content-Security-Policy.
 *
 * Modelo DENY-BY-DEFAULT: toda ruta cubierta por el matcher exige sesión,
 * salvo las explícitamente públicas de abajo. Así, cualquier ruta nueva
 * (incluida /admin y futuras) queda protegida sin tener que recordar añadirla
 * a una lista. La autorización fina (rol, tenant, platform-admin) sigue
 * verificándose dentro de cada página/Server Action — este guard es la primera
 * barrera, no la única (las Server Functions son POST a su propia ruta y deben
 * autoprotegerse; ver requireUser/requireRole en lib/auth.ts).
 */

// Rutas accesibles SIN sesión.
const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/seguridad"]);
// Prefijos públicos (flujos de auth: confirm, set-password, auth-code-error…;
// /enlace: links de paciente con token, ver app/enlace/[token]).
const PUBLIC_PREFIXES = ["/auth", "/enlace"];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

/**
 * CSP con nonce por request (ver docs/app/guides/content-security-policy).
 * `script-src 'self' 'nonce-…' 'strict-dynamic'` permite que Next.js aplique
 * el nonce automáticamente a sus propios scripts (runtime, RSC streaming,
 * swap de Suspense) sin recurrir a `'unsafe-inline'` — que dejaría pasar
 * cualquier script inline y anularía la protección contra XSS. Como TODA
 * página de la app ya es dinámica (lee sesión en cada request), no se pierde
 * optimización estática al exigir nonce.
 */
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // 'unsafe-eval' solo en dev: React lo usa para reconstruir stack traces
    // del servidor en el navegador; no se usa en producción.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Next.js no aplica el nonce a estilos (Tailwind/CSS-in-JS inline); mantenemos
    // 'unsafe-inline' aquí, que es el rango de riesgo estándar aceptado para style-src.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.deepgram.com wss://api.deepgram.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          response.headers.set("Content-Security-Policy", csp);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANTE: getUser() revalida el token (no confiar en getSession en server).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Defensa en profundidad: nunca redirigir internals de Next (chunks JS/CSS,
  // imágenes optimizadas, datos RSC). El `matcher` de abajo ya los excluye,
  // pero no queremos que la protección de rutas dependa únicamente de que ese
  // patrón sea exacto — un fallo ahí redirigiría los assets a /login y rompería
  // el render (pantalla sin estilos).
  if (path.startsWith("/_next")) {
    return response;
  }

  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    const redirectResponse = NextResponse.redirect(url);
    redirectResponse.headers.set("Content-Security-Policy", csp);
    return redirectResponse;
  }

  return response;
}

// IMPORTANTE: en Next 16 el export DEBE llamarse `config` (no `proxyConfig`),
// de lo contrario el `matcher` se ignora y el proxy corre en cada request.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
