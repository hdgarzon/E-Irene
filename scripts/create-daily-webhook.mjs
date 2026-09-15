#!/usr/bin/env node
/**
 * Crea el webhook de Daily que avisa cuando alguien entra a una sala, la señal con
 * la que se descuentan las videollamadas (migración 0058). Se corre una vez por
 * entorno, con las claves de ese entorno:
 *
 *   DAILY_API_KEY=... DAILY_WEBHOOK_HMAC=... NEXT_PUBLIC_SITE_URL=https://app.example.co \
 *     node scripts/create-daily-webhook.mjs
 *
 * DAILY_WEBHOOK_HMAC es un secreto en base64 (por ejemplo `openssl rand -base64 32`)
 * y debe ser el mismo configurado en Vercel. Al crearlo, Daily prueba la URL con
 * {"test":"test"}: la app tiene que estar desplegada con DAILY_WEBHOOK_HMAC antes.
 * El script no imprime ninguna clave.
 */

const apiKey = process.env.DAILY_API_KEY;
const hmac = process.env.DAILY_WEBHOOK_HMAC;
const site = process.env.NEXT_PUBLIC_SITE_URL;

const missing = Object.entries({ DAILY_API_KEY: apiKey, DAILY_WEBHOOK_HMAC: hmac, NEXT_PUBLIC_SITE_URL: site })
  .filter(([, value]) => !value?.trim())
  .map(([name]) => name);
if (missing.length > 0) {
  console.error(`Faltan variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (Buffer.from(hmac, "base64").length < 16) {
  console.error("DAILY_WEBHOOK_HMAC debe ser base64 de al menos 16 bytes");
  process.exit(1);
}

const url = `${site.replace(/\/$/, "")}/api/webhooks/daily`;
const res = await fetch("https://api.daily.co/v1/webhooks", {
  method: "POST",
  headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  body: JSON.stringify({ url, eventTypes: ["participant.joined"], hmac }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Daily respondió ${res.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}

let data = {};
try {
  data = JSON.parse(text);
} catch {
  // Respuesta sin JSON: se informa solo el estado HTTP.
}
console.log(`Webhook creado: uuid=${data.uuid ?? "?"} estado=${data.state ?? "?"} url=${url}`);
