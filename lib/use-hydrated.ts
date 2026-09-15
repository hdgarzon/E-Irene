"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * true cuando React ya hidrató el componente; false en el HTML del servidor y
 * durante la hidratación.
 *
 * Un control que dispara una Server Action desde un handler (onChange, onClick)
 * no hace nada antes de hidratar: el navegador acepta la interacción pero no hay
 * handler que la mande al servidor. Un <select> incluso muestra la opción nueva
 * y el cambio se pierde en silencio. Deshabilitarlo hasta entonces hace visible
 * la espera. Un <form action={...}> no lo necesita: React encola los envíos
 * previos a la hidratación.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
