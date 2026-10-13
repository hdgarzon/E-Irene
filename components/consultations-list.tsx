"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useSearchFilter } from "@/lib/use-search-filter";
import { SearchInput } from "@/components/search-input";
import { formatFullDate, formatTime } from "@/lib/dates";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { Consultation } from "@/lib/db/consultations";

const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  in_progress: { label: "En curso", tone: "info" },
  ended: { label: "Finalizada", tone: "neutral" },
  analyzed: { label: "Analizada", tone: "success" },
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
            const meta =
              c.analysisStatus === "failed"
                ? { label: "Análisis fallido", tone: "danger" as StatusTone }
                : c.analysisStatus === "pending" || c.analysisStatus === "processing"
                  ? { label: "Analizando…", tone: "neutral" as StatusTone }
                  : (STATUS_META[c.status] ?? STATUS_META.ended);
            return (
              <Link
                key={c.id}
                href={`/consultations/${c.id}`}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-cloud/60 sm:gap-4"
              >
                {/* En móvil la fecha va bajo el nombre: en columna propia dejaba
                    el nombre del paciente en tres letras. */}
                <div className="hidden w-32 shrink-0 flex-col sm:flex">
                  <span className="text-sm font-semibold tabular-nums text-navy">
                    {formatTime(c.startedAt)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatFullDate(c.startedAt)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy">{c.patientName}</p>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    {formatTime(c.startedAt)} · {formatFullDate(c.startedAt)}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{c.doctorName}</p>
                </div>

                <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
