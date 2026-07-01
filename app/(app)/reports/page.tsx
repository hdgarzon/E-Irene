import { FileText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listReports } from "@/lib/db/reports";
import { ReportsList } from "@/components/reports-list";

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
        <ReportsList reports={reports} />
      )}
    </div>
  );
}
