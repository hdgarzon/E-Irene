/**
 * Secreto del webhook de Daily para la suite e2e: lo recibe el servidor de
 * Playwright (playwright.config.ts) y lo usa la prueba para firmar eventos contra la
 * ruta real. Ficticio a propósito; nunca el de un entorno.
 */
export const E2E_DAILY_WEBHOOK_HMAC = Buffer.from("e2e-secreto-de-prueba-daily").toString("base64");
