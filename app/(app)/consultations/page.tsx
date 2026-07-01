import { Mic } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { listConsultations } from "@/lib/db/consultations";
import { ConsultationsList } from "@/components/consultations-list";

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
        <ConsultationsList consultations={consultations} />
      )}
    </div>
  );
}
