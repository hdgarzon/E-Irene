import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad estáticas (aplican igual en cada request). La
 * Content-Security-Policy vive en proxy.ts en vez de aquí: necesita un nonce
 * distinto por request (script-src con 'nonce-…' + 'strict-dynamic') para que
 * Next.js pueda seguir ejecutando sus propios scripts (runtime, streaming RSC,
 * swap de Suspense) sin recurrir a 'unsafe-inline' — que dejaría pasar
 * cualquier script inline y anularía la protección CSP contra XSS. Un valor
 * estático aquí no puede variar el nonce por request y bloquearía esos
 * scripts (ver docs/app/guides/content-security-policy).
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // La transcripción usa el micrófono desde la propia app (self).
    value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // Permite acceder al dev server vía 127.0.0.1 (usado por los E2E) sin warning.
  allowedDevOrigins: ["127.0.0.1"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
