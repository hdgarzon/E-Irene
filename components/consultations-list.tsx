"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useSearchFilter } from "@/lib/use-search-filter";
import { SearchInput } from "@/components/search-input";
import { formatFullDate, formatTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import type { Consultation } from "@/lib/db/consultations";

const STATUS_META: Record<string, { label: string; className: string }> = {
  in_progress: { label: "En curso", className: "bg-destructive/15 text-destructive" },
  ended: { label: "Finalizada", className: "bg-secondary text-secondary-foreground" },
  analyzed: { label: "Analizada", className: "bg-mint/15 text-[#04342a]" },
};

export function ConsultationsList({ consultations }: { consultations: Consultation[] }) {
  const { query, setQuery, filtered } = useSearchFilter(
    consultations,
    (c) => `${c.patientName} ${c.doctorName}`,
  );

  return (
    <div className="space-y-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Buscar por paciente o profesional…" />

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-line bg-card p-8 text-center text-sm text-muted-foreground">
          Ninguna consulta coincide con tu búsqueda.
        </p>
      ) : (
        <div className="divide-y divide-gray-line overflow-hidden rounded-2xl border border-gray-line bg-card">
          {filtered.map((c) => {
            const meta = STATUS_META[c.status] ?? STATUS_META.ended;
            return (
              <Link
                key={c.id}
                href={`/consultations/${c.id}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-cloud/60"
              >
                <div className="flex w-24 shrink-0 flex-col">
                  <span className="font-heading text-sm font-bold text-navy">
                    {formatTime(c.startedAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatFullDate(c.startedAt)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy">{c.patientName}</p>
                  <p className="truncate text-sm text-muted-foreground">{c.doctorName}</p>
                </div>

                <Badge className={meta.className}>{meta.label}</Badge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
