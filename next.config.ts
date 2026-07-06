import type { NextConfig } from "next";

/**
 * Content-Security-Policy. Base restrictiva para una app que maneja historia
 * clínica: sin frames de terceros (anti-clickjacking), sin plugins, y conexiones
 * salientes limitadas a la propia app + Supabase + Deepgram (WebSocket de audio
 * en vivo). `'unsafe-inline'` en style-src es necesario por los estilos inline
 * de Next/Tailwind; los scripts NO lo llevan (React no inyecta inline en runtime).
 *
 * Nota: si en el futuro se sirven imágenes/PDF desde Supabase Storage con URLs
 * firmadas, ya está cubierto por `https:` en img-src.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self'",
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

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
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
