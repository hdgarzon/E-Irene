// Service worker mínimo para E-Irene (PWA instalable + shell offline básico).
const CACHE = "eirene-v1";
const SHELL = ["/", "/dashboard", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Solo GET y mismo origen; nunca cachear auth/datos sensibles.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  // Navegaciones: network-first con fallback a la shell cacheada (offline).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/dashboard").then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Estáticos: cache-first.
  if (/\.(?:png|svg|ico|css|js|woff2?)$/.test(new URL(request.url).pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
  }
});
