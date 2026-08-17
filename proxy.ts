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
// `/privacidad` es público a propósito: el aviso debe poder leerse ANTES de
// crear una cuenta, y el login y el registro enlazan a él. Un aviso de
// privacidad que exige iniciar sesión no informa a nadie.
// `/sw.js`: el service worker debe poder registrarse sin sesión (se registra
// en cualquier página pública). Un service worker script NUNCA puede llegar
// como redirect (aquí, hacia /login) — el navegador rechaza directamente esa
// respuesta ("script resource is behind a redirect, which is disallowed").
const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/seguridad", "/privacidad", "/sw.js"]);
// Prefijos públicos (flujos de auth: confirm, set-password, auth-code-error…;
// /enlace: links de paciente con token, ver app/enlace/[token];
// /join: sala de videollamada del paciente, ver app/join/[token];
// /api/webhooks: llamadas servidor-a-servidor de terceros (Wompi) — nunca
// traen sesión de usuario. NO desprotegido: cada handler bajo /api/webhooks
// verifica su propia firma criptográfica (ver app/api/webhooks/wompi/route.ts)
// en vez de depender de una cookie de sesión que el emisor no puede tener.
// /api/cron: invocaciones de Vercel Cron Jobs, igual de "sin sesión". Se
// protegen con CRON_SECRET, que Vercel envía como header Authorization.
// Crítico que estén acá: los cron jobs de Vercel NO siguen redirects — un
// 307 hacia /login no es un fallo visible, la invocación simplemente termina
// y el cobro recurrente nunca corre
// (https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-jobs-and-redirects).
const PUBLIC_PREFIXES = ["/auth", "/enlace", "/join", "/api/webhooks", "/api/cron"];

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
    // del servidor en el navegador; no se usa en producción. https://*.daily.co
    // es requerido por @daily-co/daily-js cuando se usa `avoidEval: true` (ver
    // components/video-call.tsx / app/join/[token]/join-call.tsx) — evita tener
    // que habilitar 'unsafe-eval' también en producción para la videollamada.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://*.daily.co${isDev ? " 'unsafe-eval'" : ""}`,
    // Next.js no aplica el nonce a estilos (Tailwind/CSS-in-JS inline); mantenemos
    // 'unsafe-inline' aquí, que es el rango de riesgo estándar aceptado para style-src.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Daily.co (telehealth): señalización/medios vía WebRTC necesita *.daily.co
    // y *.pluot.blue (infraestructura de Daily), más wss: genérico porque los
    // servidores de medios/relay se asignan dinámicamente y no siguen un
    // subdominio fijo (ver https://docs.daily.co/guides/privacy-and-security/content-security-policy).
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.deepgram.com wss://api.deepgram.com https://*.daily.co https://*.pluot.blue wss:",
    // Web workers de @daily-co/daily-js se cargan vía blob: — sin esto caerían
    // en default-src y se bloquearían.
    "worker-src 'self' blob:",
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
//
// `missing: next-router-prefetch/purpose:prefetch` — cada prefetch de <Link>
// (Next los dispara solo con que el link esté en pantalla, no hace falta ni
// hover) volvía a pasar por acá, y como el nonce de la CSP es aleatorio por
// request, ese prefetch quedaba con un nonce distinto al de la navegación
// real que el usuario termina haciendo. Next reutiliza datos de ese prefetch
// al navegar, y el navegador terminaba bloqueando TODOS los scripts de la
// página (nonce de los <script> ≠ nonce del header CSP) — sin este `missing`
// pasaba en cualquier página después de la primera, apenas había un <Link>
// visible de por medio. Documentado como el patrón recomendado por Next.js
// para esta combinación (proxy + nonce por request + prefetch de Link).
// La autorización real no depende de esto: requireUser()/requireRole() en
// cada página y Server Action la exigen igual, con o sin este guard.
export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|mp3|wav|woff2?|ttf|otf|pdf)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
