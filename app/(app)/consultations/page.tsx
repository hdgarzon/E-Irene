import Link from "next/link";
import { ChevronRight, Mic } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listConsultations } from "@/lib/db/consultations";
import { formatFullDate, formatTime } from "@/lib/dates";
import { Badge } from "@/components/ui/badge";

const STATUS_META: Record<string, { label: string; className: string }> = {
  in_progress: { label: "En curso", className: "bg-destructive/15 text-destructive" },
  ended: { label: "Finalizada", className: "bg-secondary text-secondary-foreground" },
  analyzed: { label: "Analizada", className: "bg-mint/15 text-[#04342a]" },
};

export default async function ConsultationsPage() {
  await requireRole(["admin", "doctor"]);
  const consultations = await listConsultations();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Consultas</h1>
        <p className="text-sm text-muted-foreground">
          {consultations.length}{" "}
          {consultations.length === 1 ? "consulta registrada" : "consultas registradas"}
        </p>
      </div>

      {consultations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <Mic className="size-6 text-purple" />
          </div>
          <h3 className="font-heading font-semibold text-navy">Aún no hay consultas</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Inicia una consulta desde la ficha de un paciente con consentimiento firmado.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-line overflow-hidden rounded-2xl border border-gray-line bg-card">
          {consultations.map((c) => {
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
