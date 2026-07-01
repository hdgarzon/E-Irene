"use client";

import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { useSearchFilter } from "@/lib/use-search-filter";
import { SearchInput } from "@/components/search-input";
import { formatFullDate, formatTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";
import type { ReportListItem } from "@/lib/db/reports";

const SENTIMENT_META: Record<string, { label: string; className: string }> = {
  positivo: { label: "Positivo", className: "bg-mint/15 text-[#04342a]" },
  neutral: { label: "Neutral", className: "bg-purple/15 text-purple" },
  negativo: { label: "Negativo", className: "bg-destructive/15 text-destructive" },
};

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
            const sentiment = SENTIMENT_META[r.sentimentLabel] ?? SENTIMENT_META.neutral;
            return (
              <Link
                key={r.id}
                href={`/consultations/${r.consultationId}`}
                className="flex items-center gap-4 p-4 transition-colors hover:bg-cloud/60"
              >
                <div className="flex w-24 shrink-0 flex-col">
                  <span className="font-heading text-sm font-bold text-navy">
                    {formatTime(r.date)}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatFullDate(r.date)}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy">{r.patientName}</p>
                  <p className="text-sm text-muted-foreground">
                    Sentimiento: {sentiment.label} ({r.sentimentScore.toFixed(2)})
                  </p>
                </div>

                <Badge className={sentiment.className}>{sentiment.label}</Badge>

                {r.validated ? (
                  <span className="flex items-center gap-1 text-xs text-mint">
                    <ShieldCheck className="size-3.5" />
                    Validado
                  </span>
                ) : (
                  <Badge variant="secondary">Sin validar</Badge>
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
