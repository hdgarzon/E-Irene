import { describe, it, expect, vi } from "vitest";
import {
  MAX_QUERY_LENGTH,
  describeListPage,
  fetchListPage,
  ilikeCondition,
  listHref,
  pageBounds,
  pageCount,
  readListParams,
  type ListPage,
} from "@/lib/admin-list";

// Paginación de las listas de la consola del admin (lib/admin-list.ts). Existen
// porque PostgREST corta en 1000 filas sin avisar: estas pruebas fijan que los
// totales salgan de conteos y que ninguna lista muestre un total truncado.

const conteo = (count: number | null, error: unknown = null) => () =>
  Promise.resolve({ count, error });

const filas = (data: unknown[]) => vi.fn(() => Promise.resolve({ data, error: null }));

function lista(overrides: Partial<ListPage<unknown>> = {}): ListPage<unknown> {
  return { items: [], total: 0, matched: 0, page: 1, pageSize: 20, query: "", ...overrides };
}

describe("readListParams", () => {
  it("sin parámetros: primera página y sin búsqueda", () => {
    expect(readListParams({})).toEqual({ query: "", page: 1 });
  });

  it("recorta la búsqueda y la acota a MAX_QUERY_LENGTH", () => {
    expect(readListParams({ q: "  Clínica Demo  " }).query).toBe("Clínica Demo");
    expect(readListParams({ q: "x".repeat(MAX_QUERY_LENGTH + 50) }).query).toHaveLength(
      MAX_QUERY_LENGTH,
    );
  });

  it("una página inválida vuelve a la primera", () => {
    for (const page of ["0", "-3", "abc", ""]) {
      expect(readListParams({ page }).page).toBe(1);
    }
    expect(readListParams({ page: "7" }).page).toBe(7);
  });

  it("con un parámetro repetido toma el primer valor", () => {
    expect(readListParams({ q: ["Demo", "Otra"], page: ["3", "9"] })).toEqual({
      query: "Demo",
      page: 3,
    });
  });

  it("lee la página de otro parámetro cuando hay dos listas en la pantalla", () => {
    expect(readListParams({ pendientes: "4", page: "2" }, "pendientes").page).toBe(4);
  });
});

describe("pageBounds y pageCount", () => {
  it("convierte la página en el rango inclusivo de .range()", () => {
    expect(pageBounds(1, 50)).toEqual({ from: 0, to: 49 });
    expect(pageBounds(3, 20)).toEqual({ from: 40, to: 59 });
  });

  it("siempre hay al menos una página", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(1753, 20)).toBe(88);
  });
});

describe("fetchListPage", () => {
  it("el total sale del conteo, no del largo de las filas traídas", async () => {
    const fetchRows = filas([{ n: 1 }, { n: 2 }]);
    const countMatched = vi.fn(conteo(0));

    const page = await fetchListPage({
      params: { query: "", page: 1 },
      pageSize: 2,
      countTotal: conteo(1753),
      countMatched,
      fetchRows,
      map: (r: { n: number }) => r.n,
    });

    expect(page).toEqual({ items: [1, 2], total: 1753, matched: 1753, page: 1, pageSize: 2, query: "" });
    expect(fetchRows).toHaveBeenCalledWith(0, 1);
    // Sin búsqueda no hace falta un segundo conteo.
    expect(countMatched).not.toHaveBeenCalled();
  });

  it("con búsqueda cuenta las coincidencias aparte y pide solo el rango de la página", async () => {
    const fetchRows = filas([{ n: 21 }]);

    const page = await fetchListPage({
      params: { query: "Demo", page: 2 },
      pageSize: 20,
      countTotal: conteo(1753),
      countMatched: conteo(21),
      fetchRows,
      map: (r: { n: number }) => r.n,
    });

    expect(page).toMatchObject({ total: 1753, matched: 21, page: 2, query: "Demo", items: [21] });
    expect(fetchRows).toHaveBeenCalledWith(20, 39);
  });

  it("una página más allá del final muestra la última en vez de una lista vacía", async () => {
    const fetchRows = filas([]);

    const page = await fetchListPage({
      params: { query: "", page: 99 },
      pageSize: 20,
      countTotal: conteo(45),
      countMatched: conteo(0),
      fetchRows,
      map: (r) => r,
    });

    expect(page.page).toBe(3);
    expect(fetchRows).toHaveBeenCalledWith(40, 59);
  });

  it("sin coincidencias no pide filas", async () => {
    const fetchRows = filas([]);

    const page = await fetchListPage({
      params: { query: "nada", page: 4 },
      pageSize: 20,
      countTotal: conteo(1753),
      countMatched: conteo(0),
      fetchRows,
      map: (r) => r,
    });

    expect(page).toMatchObject({ items: [], total: 1753, matched: 0, page: 1 });
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("si un conteo falla o no llega, falla en vez de inventar un total", async () => {
    const base = {
      params: { query: "", page: 1 },
      pageSize: 20,
      countMatched: conteo(0),
      fetchRows: filas([{}]),
      map: (r: unknown) => r,
    };
    const error = { message: "permission denied" };

    await expect(fetchListPage({ ...base, countTotal: conteo(null, error) })).rejects.toBe(error);
    await expect(fetchListPage({ ...base, countTotal: conteo(null) })).rejects.toThrow(
      /no devolvió un total/,
    );
  });

  it("propaga el error de la consulta de filas", async () => {
    const error = { message: "timeout" };
    await expect(
      fetchListPage({
        params: { query: "", page: 1 },
        pageSize: 20,
        countTotal: conteo(5),
        countMatched: conteo(0),
        fetchRows: () => Promise.resolve({ data: null, error }),
        map: (r) => r,
      }),
    ).rejects.toBe(error);
  });
});

describe("ilikeCondition", () => {
  it("busca el texto en cualquier parte, entre comillas", () => {
    expect(ilikeCondition("name", "Clínica")).toBe('name.ilike."%Clínica%"');
  });

  it("toma literal los comodines de LIKE", () => {
    expect(ilikeCondition("name", "50%_off")).toBe(String.raw`name.ilike."%50\\%\\_off%"`);
  });

  it("escapa comillas y barras invertidas dentro de las comillas", () => {
    expect(ilikeCondition("full_name", String.raw`a"b\c`)).toBe(
      String.raw`full_name.ilike."%a\"b\\\\c%"`,
    );
  });

  it("comas, puntos y paréntesis quedan dentro de las comillas y no parten el filtro", () => {
    expect(ilikeCondition("email", "a,b(c).d")).toBe('email.ilike."%a,b(c).d%"');
  });

  it("descarta el asterisco, que PostgREST convierte en comodín", () => {
    expect(ilikeCondition("name", "De*mo")).toBe('name.ilike."%Demo%"');
  });
});

describe("describeListPage", () => {
  const clinicas = { singular: "clínica", plural: "clínicas" };

  it("sin búsqueda dice el total y qué filas se muestran", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(describeListPage(lista({ items, total: 1753, matched: 1753, page: 2 }), clinicas)).toBe(
      "1753 clínicas en total · mostrando 21–40",
    );
    expect(describeListPage(lista({ items: [1], total: 1, matched: 1 }), clinicas)).toBe(
      "1 clínica en total · mostrando 1–1",
    );
  });

  it("con búsqueda dice cuántas coinciden sobre el total, no solo las encontradas", () => {
    expect(
      describeListPage(lista({ items: [1], total: 1753, matched: 1, query: "Console" }), clinicas),
    ).toBe('1 de 1753 clínicas coincide con "Console" · mostrando 1–1');
    expect(
      describeListPage(lista({ total: 1753, matched: 0, query: "zzz" }), clinicas),
    ).toBe('0 de 1753 clínicas coinciden con "zzz"');
  });

  it("sin registros no muestra un rango", () => {
    expect(describeListPage(lista(), clinicas)).toBe("0 clínicas en total");
  });
});

describe("listHref", () => {
  it("omite los parámetros vacíos", () => {
    expect(listHref("/admin/clinicas", { q: "", page: undefined })).toBe("/admin/clinicas");
  });

  it("codifica la búsqueda y conserva los demás parámetros", () => {
    const href = listHref("/admin/verificaciones", { q: "Clínica Á&B", pendientes: 2, page: 3 });
    const url = new URL(href, "http://127.0.0.1");
    expect(url.pathname).toBe("/admin/verificaciones");
    expect(url.searchParams.get("q")).toBe("Clínica Á&B");
    expect(url.searchParams.get("pendientes")).toBe("2");
    expect(url.searchParams.get("page")).toBe("3");
  });
});
