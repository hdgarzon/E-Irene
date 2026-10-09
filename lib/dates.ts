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

/** Fecha sin día de la semana: "18 de octubre de 2026". */
export function formatLongDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

// Colombia no tiene horario de verano: la hora de Bogotá es siempre UTC-5.
// Mismo supuesto que fromInputDateTime.
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Suma meses calendario en hora de Bogotá, conservando el día y la hora del
 * origen. Si ese día no existe en el mes de destino, cae en el último: 31-ene
 * + 1 mes = 28-feb (29 en bisiesto), y 31-ene + 2 meses = 31-mar.
 *
 * Replica `timestamp + interval 'N months'` de Postgres y tiene que dar
 * exactamente lo mismo que add_billing_months (migración 0041), que es la que
 * aplica la cuota. tests/billing-cycle.test.ts compara las dos.
 */
export function addMonthsBogota(from: string | Date, months: number): Date {
  const origin = typeof from === "string" ? new Date(from) : from;
  // "Hora de pared" de Bogotá, leída con los getters UTC.
  const wall = new Date(origin.getTime() - BOGOTA_OFFSET_MS);
  const totalMonths = wall.getUTCFullYear() * 12 + wall.getUTCMonth() + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const shiftedWall = Date.UTC(
    year,
    month,
    Math.min(wall.getUTCDate(), lastDayOfMonth),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds(),
  );
  return new Date(shiftedWall + BOGOTA_OFFSET_MS);
}

/**
 * Ciclo mensual de la clínica que contiene `at`: [start, end).
 *
 * Los ciclos se cuentan siempre desde el ancla (`clinics.billing_cycle_anchor`)
 * y no encadenando el fin del anterior: así un ancla del 31 da 28-feb y vuelve
 * al 31-mar, en vez de quedarse corrida al 28 para siempre. Las cuotas del plan
 * (consultas y horas de transcripción) se reinician al empezar cada ciclo, no
 * el día 1 del mes.
 */
export function billingCycleBounds(
  anchor: string | Date,
  at: Date = new Date(),
): { start: Date; end: Date } {
  const origin = typeof anchor === "string" ? new Date(anchor) : anchor;
  const wallAnchor = new Date(origin.getTime() - BOGOTA_OFFSET_MS);
  const wallAt = new Date(at.getTime() - BOGOTA_OFFSET_MS);
  let months =
    (wallAt.getUTCFullYear() - wallAnchor.getUTCFullYear()) * 12 +
    (wallAt.getUTCMonth() - wallAnchor.getUTCMonth());
  // En el mes de `at` el ciclo puede no haber empezado todavía (el día del
  // ancla es posterior): entonces el vigente es el que empezó el mes anterior.
  if (addMonthsBogota(origin, months).getTime() > at.getTime()) months -= 1;
  return { start: addMonthsBogota(origin, months), end: addMonthsBogota(origin, months + 1) };
}

/**
 * Instante en UTC con el formato de `expires_at` de los links de Wompi,
 * "2040-12-10T14:30:00": sin zona ni milisegundos. Wompi no documenta en qué zona lo
 * lee; la vigencia que cuenta la comprueba la base contra la fecha de creación de la
 * transacción (fulfill_plan_purchase, apply_plan_upgrade).
 */
export function toWompiUtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19);
}

/** true si `iso` fue hace más de `days` días. */
export function isMoreThanDaysAgo(iso: string, days: number): boolean {
  return Date.now() - new Date(iso).getTime() > days * 24 * 60 * 60 * 1000;
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

// ── Días hábiles en Colombia ────────────────────────────────────────────────
// Los plazos legales de respuesta (15 días hábiles para una PQR, Ley 1480;
// 10 y 15 para consultas y reclamos de datos, Ley 1581) se cuentan en días
// hábiles: sin sábados, domingos ni festivos nacionales.

/** Fecha UTC a medianoche de un día de calendario (año, mes 1-12, día). */
function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDay(year, month, day);
}

/** Ley Emiliani (Ley 51 de 1983): el festivo que no cae en lunes pasa al lunes siguiente. */
function nextMonday(d: Date): Date {
  const offset = (8 - d.getUTCDay()) % 7;
  return addDaysUtc(d, offset);
}

const holidayCache = new Map<number, Set<string>>();

/** Festivos nacionales de Colombia de un año, como claves YYYY-MM-DD. */
export function colombianHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const easter = easterSunday(year);
  const days = [
    // No se trasladan.
    utcDay(year, 1, 1),
    utcDay(year, 5, 1),
    utcDay(year, 7, 20),
    utcDay(year, 8, 7),
    utcDay(year, 12, 8),
    utcDay(year, 12, 25),
    addDaysUtc(easter, -3), // Jueves Santo
    addDaysUtc(easter, -2), // Viernes Santo
    // Se trasladan al lunes siguiente.
    ...[
      utcDay(year, 1, 6),
      utcDay(year, 3, 19),
      utcDay(year, 6, 29),
      utcDay(year, 8, 15),
      utcDay(year, 10, 12),
      utcDay(year, 11, 1),
      utcDay(year, 11, 11),
    ].map(nextMonday),
    // Ascensión, Corpus Christi y Sagrado Corazón: lunes fijos tras la Pascua.
    addDaysUtc(easter, 43),
    addDaysUtc(easter, 64),
    addDaysUtc(easter, 71),
  ];
  const set = new Set(days.map((d) => d.toISOString().slice(0, 10)));
  holidayCache.set(year, set);
  return set;
}

/** true si el día de calendario (YYYY-MM-DD) es hábil en Colombia. */
export function isBusinessDayColombia(key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  const weekday = utcDay(y, m, d).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !colombianHolidays(y).has(key);
}

/**
 * Último día del plazo: el día hábil número `days` contado desde el siguiente
 * a la fecha de presentación (en hora de Bogotá). Devuelve YYYY-MM-DD.
 */
export function addBusinessDaysColombia(from: string | Date, days: number): string {
  let cursor = new Date(`${dayKey(from)}T00:00:00Z`);
  let counted = 0;
  while (counted < days) {
    cursor = addDaysUtc(cursor, 1);
    if (isBusinessDayColombia(cursor.toISOString().slice(0, 10))) counted += 1;
  }
  return cursor.toISOString().slice(0, 10);
}
