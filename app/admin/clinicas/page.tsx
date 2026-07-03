import { getClinicMap } from "@/lib/db/platform-console";
import { AdminClinicCard } from "@/components/admin-clinic-card";

export default async function AdminClinicasPage() {
  const clinics = await getClinicMap();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Clínicas</h1>
        <p className="text-sm text-muted-foreground">
          {clinics.length} {clinics.length === 1 ? "clínica" : "clínicas"} · sus profesionales y
          gestión de plan / estado.
        </p>
      </div>

      {clinics.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay clínicas registradas.</p>
      ) : (
        <div className="space-y-4">
          {clinics.map((c) => (
            <AdminClinicCard key={c.clinicId} clinic={c} />
          ))}
        </div>
      )}
    </div>
  );
}
