"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Patient } from "@/lib/db/patient-mappers";

const DEBOUNCE_MS = 300;

/**
 * Búsqueda y paginación server-driven vía la URL (?q=&page=): el input solo
 * refleja el estado local mientras se escribe y, tras el debounce, actualiza
 * la URL para que el Server Component vuelva a buscar. Esto es lo que permite
 * escalar la búsqueda sin descifrar toda la tabla de pacientes en el cliente
 * (ver searchPatients en lib/db/patients.ts).
 */
export function PatientsTable({
  patients,
  query,
  page,
  hasMore,
  pageSize,
}: {
  patients: Patient[];
  query: string;
  page: number;
  hasMore: boolean;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(query);

  useEffect(() => {
    if (value === query) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      router.push(params.size > 0 ? `${pathname}?${params}` : pathname);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, query, pathname, router]);

  function goToPage(target: number) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (target > 1) params.set("page", String(target));
    router.push(params.size > 0 ? `${pathname}?${params}` : pathname);
  }

  return (
    <div className="space-y-4">
      <SearchInput
        value={value}
        onChange={setValue}
        placeholder="Buscar por nombre, documento o teléfono (mín. 3 caracteres)…"
      />

      {patients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <Search className="size-6 text-purple" />
          </div>
          <h3 className="font-heading font-semibold text-navy">Ningún paciente coincide</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Prueba con otro nombre, documento o teléfono.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-line bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead className="text-right">Registrado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((p) => (
                <TableRow key={p.id} className="cursor-default">
                  <TableCell>
                    <Link
                      href={`/patients/${p.id}`}
                      className="font-medium text-navy hover:text-purple hover:underline"
                    >
                      {p.fullName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.document ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.phone ?? "—"}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(p.createdAt).toLocaleDateString("es-CO")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
          >
            <ChevronLeft className="size-4" />
            Anterior
          </Button>
          <span className="text-xs text-muted-foreground">
            Página {page} · {pageSize} por página
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => goToPage(page + 1)}
          >
            Siguiente
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
