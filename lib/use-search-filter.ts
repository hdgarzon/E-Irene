"use client";

import { useMemo, useState } from "react";
import { normalizeSearchText } from "@/lib/text-normalize";

/**
 * Filtro de búsqueda client-side sobre una lista ya cargada. Vive en el
 * cliente porque un Server Component no puede pasar funciones (getText) a
 * un Client Component — solo datos serializables — así que cada lista
 * (pacientes, consultas, reportes) recibe los datos ya descifrados como
 * prop y filtra localmente aquí, sin round-trip extra al servidor.
 */
export function useSearchFilter<T>(items: T[], getText: (item: T) => string) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query.trim());
    if (!q) return items;
    return items.filter((item) => normalizeSearchText(getText(item)).includes(q));
  }, [items, query, getText]);

  return { query, setQuery, filtered };
}
