/**
 * Listas paginadas de la consola del admin de plataforma (app/admin).
 *
 * PostgREST corta cada respuesta en `max_rows` (1000, supabase/config.toml) sin
 * dar error. Una lista traída entera mostraba las primeras 1000 filas y su
 * largo pasaba por el total: con 1753 clínicas, /admin/clinicas decía "1000
 * clínicas" y /admin/doctores escondía las cuentas más nuevas.
 *
 * Por eso cada lista de /admin pide solo su página con `.range()`, y los
 * totales salen de conteos `count: "exact", head: true` — nunca del largo de lo
 * que se trajo.
 */

export const ADMIN_PAGE_SIZE = 50;

/** Tope del texto de búsqueda: no arrastrar patrones enormes a la URL ni a la BD. */
export const MAX_QUERY_LENGTH = 100;

type SearchParamValue = string | string[] | undefined;

export interface ListParams {
  /** Texto de búsqueda ya recortado; "" = sin búsqueda. */
  query: string;
  /** Página pedida, desde 1. */
  page: number;
}

/** Lee `?q=` y la página (`?page=` por defecto) de los searchParams de una ruta. */
export function readListParams(
  searchParams: Record<string, SearchParamValue>,
  pageKey = "page",
): ListParams {
  const first = (value: SearchParamValue) => (Array.isArray(value) ? value[0] : value) ?? "";
  const query = first(searchParams.q).trim().slice(0, MAX_QUERY_LENGTH).trim();
  const page = Number.parseInt(first(searchParams[pageKey]), 10);
  return { query, page: Number.isFinite(page) && page >= 1 ? page : 1 };
}

export interface ListPage<T> {
  items: T[];
  /** Registros de la lista sin búsqueda (conteo exacto en BD). */
  total: number;
  /** Registros que coinciden con la búsqueda; igual a `total` sin búsqueda. */
  matched: number;
  /** Página mostrada: la pedida, acotada a las que existen. */
  page: number;
  pageSize: number;
  query: string;
}

export function pageCount(count: number, pageSize: number): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

/** Filas `[from, to]` (base 0, inclusive) que pide `.range()` para una página. */
export function pageBounds(page: number, pageSize: number): { from: number; to: number } {
  const from = (Math.max(1, page) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

interface CountResult {
  count: number | null;
  error: unknown;
}

interface RowsResult {
  data: unknown;
  error: unknown;
}

function exactCount(result: CountResult): number {
  if (result.error) throw result.error;
  // Con count: "exact" PostgREST siempre informa el conteo. Si no llega, mostrar
  // 0 o el largo de la página sería justo el total engañoso que se quiere evitar.
  if (result.count === null) throw new Error("La consulta de conteo no devolvió un total");
  return result.count;
}

/**
 * Arma una página en dos pasos: primero los conteos (head, sin traer filas) y
 * luego solo las filas de la página. La página se acota a las que existen, así
 * que pedir una más allá del final muestra la última en vez de una lista vacía
 * que parezca "no hay resultados".
 *
 * `countMatched` solo se llama si hay búsqueda; sin ella, coincide con el total.
 */
export async function fetchListPage<R, T>(options: {
  params: ListParams;
  pageSize: number;
  countTotal: () => PromiseLike<CountResult>;
  countMatched: () => PromiseLike<CountResult>;
  fetchRows: (from: number, to: number) => PromiseLike<RowsResult>;
  map: (row: R) => T;
}): Promise<ListPage<T>> {
  const { params, pageSize } = options;
  const searching = params.query.length > 0;

  const [totalResult, matchedResult] = await Promise.all([
    options.countTotal(),
    searching ? options.countMatched() : null,
  ]);
  const total = exactCount(totalResult);
  const matched = matchedResult ? exactCount(matchedResult) : total;
  const page = Math.min(Math.max(1, params.page), pageCount(matched, pageSize));
  const base = { total, matched, page, pageSize, query: params.query };

  if (matched === 0) return { items: [], ...base };

  const { from, to } = pageBounds(page, pageSize);
  const { data, error } = await options.fetchRows(from, to);
  if (error) throw error;
  return { items: ((data ?? []) as R[]).map(options.map), ...base };
}

/**
 * Condición `columna.ilike."%texto%"` para `.or()` de PostgREST, con el texto
 * tomado literal. Se escapan los comodines de LIKE (`%`, `_`, `\`), y al ir
 * entre comillas las comas, puntos y paréntesis no rompen el filtro. `*` no
 * tiene escape en PostgREST (lo traduce a `%`), así que se descarta.
 */
export function ilikeCondition(column: string, query: string): string {
  const literal = query.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
  const quoted = `%${literal}%`.replace(/[\\"]/g, (c) => `\\${c}`);
  return `${column}.ilike."${quoted}"`;
}

export interface ListNoun {
  singular: string;
  plural: string;
}

/**
 * Encabezado de una lista: cuántos hay en total y cuáles se muestran. Con
 * búsqueda dice cuántos coinciden sobre el total, para que un resultado parcial
 * nunca se lea como el total de la plataforma.
 */
export function describeListPage(list: ListPage<unknown>, noun: ListNoun): string {
  const of = (count: number) => `${count} ${count === 1 ? noun.singular : noun.plural}`;
  const shown = list.items.length;
  const from = pageBounds(list.page, list.pageSize).from + 1;
  const range = shown > 0 ? ` · mostrando ${from}–${from + shown - 1}` : "";

  if (list.query) {
    const verb = list.matched === 1 ? "coincide" : "coinciden";
    return `${list.matched} de ${of(list.total)} ${verb} con "${list.query}"${range}`;
  }
  return `${of(list.total)} en total${range}`;
}

/** URL de la lista con sus parámetros, omitiendo los vacíos. */
export function listHref(
  pathname: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}
