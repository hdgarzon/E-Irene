import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * proxy.ts (Next.js 16; reemplaza a middleware.ts).
 * Refresca la sesión de Supabase en cada request y protege las rutas de la app.
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
const PUBLIC_PATHS = new Set(["/", "/login", "/signup"]);
// Prefijos públicos (flujos de auth: confirm, set-password, auth-code-error…).
const PUBLIC_PREFIXES = ["/auth"];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
    return NextResponse.redirect(url);
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
