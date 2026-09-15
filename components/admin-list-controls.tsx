import Form from "next/form";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAX_QUERY_LENGTH, listHref, pageCount, type ListPage } from "@/lib/admin-list";

/**
 * Búsqueda del lado del servidor para las listas de /admin: un GET a la misma
 * ruta con ?q=. No arrastra la página, así que cada búsqueda empieza en la
 * primera.
 */
export function AdminSearchForm({
  action,
  query,
  label,
  placeholder,
}: {
  action: string;
  query: string;
  label: string;
  placeholder: string;
}) {
  return (
    <Form action={action} role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          // Sin key, el input no controlado conservaría el texto viejo al limpiar.
          key={query}
          type="search"
          name="q"
          defaultValue={query}
          aria-label={label}
          placeholder={placeholder}
          maxLength={MAX_QUERY_LENGTH}
          className="bg-card pl-9"
        />
      </div>
      <Button type="submit" variant="outline">
        Buscar
      </Button>
      {query && (
        <Link href={action} className={buttonVariants({ variant: "ghost" })}>
          Limpiar
        </Link>
      )}
    </Form>
  );
}

/**
 * Anterior / siguiente de una lista paginada en BD. `params` conserva los
 * parámetros de otras listas de la misma pantalla.
 */
export function AdminPagination({
  pathname,
  list,
  pageKey = "page",
  params = {},
}: {
  pathname: string;
  list: ListPage<unknown>;
  pageKey?: string;
  params?: Record<string, string | number | undefined>;
}) {
  const pages = pageCount(list.matched, list.pageSize);
  if (pages <= 1) return null;

  const href = (page: number) =>
    listHref(pathname, {
      ...params,
      q: list.query,
      [pageKey]: page > 1 ? page : undefined,
    });
  const step = buttonVariants({ variant: "outline", size: "sm" });
  const disabled = cn(step, "pointer-events-none opacity-50");

  return (
    <nav aria-label="Paginación" className="flex items-center justify-between gap-3">
      {list.page > 1 ? (
        <Link href={href(list.page - 1)} className={step}>
          <ChevronLeft /> Anterior
        </Link>
      ) : (
        <span aria-disabled="true" className={disabled}>
          <ChevronLeft /> Anterior
        </span>
      )}
      <span className="text-xs text-muted-foreground tabular-nums">
        Página {list.page} de {pages}
      </span>
      {list.page < pages ? (
        <Link href={href(list.page + 1)} className={step}>
          Siguiente <ChevronRight />
        </Link>
      ) : (
        <span aria-disabled="true" className={disabled}>
          Siguiente <ChevronRight />
        </span>
      )}
    </nav>
  );
}
