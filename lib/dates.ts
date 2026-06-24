/** Helpers de fecha/hora en zona horaria de Colombia (sin DST). */

const TZ = "America/Bogota";

/** Clave de día local (YYYY-MM-DD) en Bogotá, para agrupar. */
export function dayKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Hora local "14:30". */
export function formatTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Etiqueta de día: "Hoy", "Mañana", "Ayer" o "lunes, 23 jun". */
export function formatDayLabel(key: string): string {
  const now = new Date();
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));

  if (key === today) return "Hoy";
  if (key === tomorrow) return "Mañana";
  if (key === yesterday) return "Ayer";

  // Mediodía Bogotá para evitar desfase de zona al parsear la clave.
  const d = new Date(`${key}T12:00:00-05:00`);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(d);
}

/** Fecha completa legible: "lunes, 15 de enero de 2030". */
export function formatFullDate(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/** ISO → "YYYY-MM-DDTHH:mm" en Bogotá, para <input type="datetime-local">. */
export function toInputDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "YYYY-MM-DDTHH:mm" (hora Bogotá) → ISO UTC. */
export function fromInputDateTime(local: string): string {
  return new Date(`${local}:00-05:00`).toISOString();
}

/** Agrupa items con `scheduledAt` por día local, en orden cronológico. */
export function groupByDay<T extends { scheduledAt: string }>(
  items: T[],
): { key: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = dayKey(item.scheduledAt);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, groupItems]) => ({ key, label: formatDayLabel(key), items: groupItems }));
}
