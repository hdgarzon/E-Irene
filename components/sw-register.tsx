"use client";

import { useEffect } from "react";

/** Registra el service worker para habilitar la PWA (instalable + offline básico). */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registro best-effort; no es crítico para la app.
      });
    }
  }, []);
  return null;
}
