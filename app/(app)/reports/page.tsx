import Link from "next/link";
import { ChevronRight, FileText, ShieldCheck } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listReports } from "@/lib/db/reports";
import { formatFullDate, formatTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";

const SENTIMENT_META: Record<string, { label: string; className: string }> = {
  positivo: { label: "Positivo", className: "bg-mint/15 text-[#04342a]" },
  neutral: { label: "Neutral", className: "bg-purple/15 text-purple" },
  negativo: { label: "Negativo", className: "bg-destructive/15 text-destructive" },
};

export default async function ReportsPage() {
  await requireRole(["admin", "doctor"]);
  const reports = await listReports();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          {reports.length} {reports.length === 1 ? "reporte generado" : "reportes generados"}
        </p>
      </div>

      {reports.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <FileText className="size-6 text-purple" />
          </div>
          <h3 className="font-heading font-semibold text-navy">Aún no hay reportes</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            El reporte con análisis de IA se genera automáticamente al finalizar una consulta.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-line overflow-hidden rounded-2xl border border-gray-line bg-card">
          {reports.map((r) => {
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
