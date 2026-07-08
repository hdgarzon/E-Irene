import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { searchPatients, PATIENTS_PAGE_SIZE } from "@/lib/db/patients";
import { isSearchableQuery, MIN_QUERY_LENGTH } from "@/lib/search-index";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PatientsTable } from "@/components/patients-table";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q = "", page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const { patients, total, hasMore, truncated } = await searchPatients({ query: q, page });
  // Una query no vacía pero más corta que MIN_QUERY_LENGTH no filtra nada
  // (ver searchPatients) — el texto no debe insinuar que sí se buscó.
  const isFiltering = isSearchableQuery(q);
  const isTyping = q.trim().length > 0 && !isFiltering;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">Pacientes</h1>
          <p className="text-sm text-muted-foreground">
            {isFiltering
              ? `${total} resultado${total === 1 ? "" : "s"} para "${q}"`
              : isTyping
                ? `Escribe al menos ${MIN_QUERY_LENGTH} caracteres para buscar`
                : `${total} paciente${total === 1 ? "" : "s"} en tu clínica`}
            {truncated && " · refina la búsqueda para ver todos los resultados"}
          </p>
        </div>
        <Link href="/patients/new" className={cn(buttonVariants())}>
          <Plus className="size-4" />
          Nuevo paciente
        </Link>
      </div>

      {total === 0 && !isFiltering ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <Users className="size-6 text-purple" />
          </div>
          <h3 className="font-heading font-semibold text-navy">Aún no hay pacientes</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Registra a tu primer paciente para empezar a agendar citas y consultas.
          </p>
          <Link href="/patients/new" className={cn(buttonVariants(), "mt-5")}>
            <Plus className="size-4" />
            Registrar paciente
          </Link>
        </div>
      ) : (
        // El buscador vive dentro de PatientsTable y debe seguir visible aunque
        // la búsqueda actual no tenga resultados, para poder corregirla sin
        // editar la URL a mano.
        <PatientsTable
          patients={patients}
          query={q}
          page={page}
          hasMore={hasMore}
          pageSize={PATIENTS_PAGE_SIZE}
        />
      )}
    </div>
  );
}
