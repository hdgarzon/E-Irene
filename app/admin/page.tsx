import { Building2, Users, Mic, Stethoscope } from "lucide-react";
import { getPlatformClinicOverview } from "@/lib/db/platform-admin";
import { PLANS, type Plan } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";

export default async function AdminDashboardPage() {
  const clinics = await getPlatformClinicOverview();

  const totalPatients = clinics.reduce((sum, c) => sum + c.patientCount, 0);
  const totalConsultations = clinics.reduce((sum, c) => sum + c.consultationCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Clínicas registradas</h1>
        <p className="text-sm text-muted-foreground">
          Vista de negocio — sin acceso a datos clínicos de pacientes. {clinics.length}{" "}
          {clinics.length === 1 ? "clínica" : "clínicas"} en la plataforma.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-line bg-card p-5">
          <p className="text-xs text-muted-foreground">Clínicas</p>
          <p className="font-heading text-2xl font-bold text-navy">{clinics.length}</p>
        </div>
        <div className="rounded-2xl border border-gray-line bg-card p-5">
          <p className="text-xs text-muted-foreground">Pacientes totales</p>
          <p className="font-heading text-2xl font-bold text-navy">{totalPatients}</p>
        </div>
        <div className="rounded-2xl border border-gray-line bg-card p-5">
          <p className="text-xs text-muted-foreground">Consultas totales</p>
          <p className="font-heading text-2xl font-bold text-navy">{totalConsultations}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        {clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay clínicas registradas.</p>
        ) : (
          <ul className="divide-y divide-gray-line">
            {clinics.map((c) => (
              <li key={c.clinicId} className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3">
                  <Building2 className="size-4 text-purple" />
                  <div>
                    <p className="font-medium text-navy">{c.clinicName}</p>
                    <p className="text-xs text-muted-foreground">
                      Registrada el {new Date(c.createdAt).toLocaleDateString("es-CO")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Stethoscope className="size-3.5" /> {c.doctorCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" /> {c.patientCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Mic className="size-3.5" /> {c.consultationCount}
                  </span>
                  <Badge className="bg-purple/15 text-purple">
                    {PLANS[c.plan as Plan]?.label ?? c.plan}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
