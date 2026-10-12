"use client";

import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { useSearchFilter } from "@/lib/use-search-filter";
import { SearchInput } from "@/components/search-input";
import { formatFullDate, formatTime } from "@/lib/dates";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ReportListItem } from "@/lib/db/reports";

export function ReportsList({ reports }: { reports: ReportListItem[] }) {
  const { query, setQuery, filtered } = useSearchFilter(reports, (r) => r.patientName);

  return (
    <div className="space-y-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Buscar por paciente…" />

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-line bg-card p-8 text-center text-sm text-muted-foreground">
          Ningún reporte coincide con tu búsqueda.
        </p>
      ) : (
        <div className="divide-y divide-gray-line overflow-hidden rounded-2xl border border-gray-line bg-card">
          {filtered.map((r) => {
            return (
              <Link
                key={r.id}
                href={`/consultations/${r.consultationId}`}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-cloud/60 sm:gap-4"
              >
                {/* En móvil la fecha va bajo el nombre: en columna propia dejaba
                    el nombre del paciente en tres letras. */}
                <div className="hidden w-32 shrink-0 flex-col sm:flex">
                  <span className="text-sm font-semibold tabular-nums text-navy">
                    {formatTime(r.date)}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatFullDate(r.date)}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy">{r.patientName}</p>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {formatTime(r.date)} · {formatFullDate(r.date)}
                  </p>
                </div>

                {r.validated ? (
                  <StatusBadge tone="success">
                    <ShieldCheck className="size-3.5" />
                    Validado
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="warning">Sin validar</StatusBadge>
                )}

                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
