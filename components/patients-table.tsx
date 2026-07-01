"use client";

import Link from "next/link";
import { useSearchFilter } from "@/lib/use-search-filter";
import { SearchInput } from "@/components/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Patient } from "@/lib/db/patient-mappers";

export function PatientsTable({ patients }: { patients: Patient[] }) {
  const { query, setQuery, filtered } = useSearchFilter(
    patients,
    (p) => `${p.fullName} ${p.document ?? ""} ${p.phone ?? ""}`,
  );

  return (
    <div className="space-y-4">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Buscar por nombre, documento o teléfono…"
      />

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-line bg-card p-8 text-center text-sm text-muted-foreground">
          Ningún paciente coincide con tu búsqueda.
        </p>
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
              {filtered.map((p) => (
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
    </div>
  );
}
