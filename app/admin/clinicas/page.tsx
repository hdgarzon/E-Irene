import { getClinicMap } from "@/lib/db/platform-console";
import { describeListPage, readListParams } from "@/lib/admin-list";
import { AdminClinicCard } from "@/components/admin-clinic-card";
import { AdminPagination, AdminSearchForm } from "@/components/admin-list-controls";

const PATH = "/admin/clinicas";

export default async function AdminClinicasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const clinics = await getClinicMap(readListParams(await searchParams));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Clínicas</h1>
        <p data-testid="list-summary" className="text-sm text-muted-foreground">
          {describeListPage(clinics, { singular: "clínica", plural: "clínicas" })}. Las más
          recientes primero, con sus profesionales y gestión de plan / estado.
        </p>
      </div>

      <AdminSearchForm
        action={PATH}
        query={clinics.query}
        label="Buscar clínica"
        placeholder="Buscar clínica por nombre…"
      />

      {clinics.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {clinics.query
            ? `Ninguna clínica coincide con "${clinics.query}".`
            : "Aún no hay clínicas registradas."}
        </p>
      ) : (
        <div className="space-y-4">
          {clinics.items.map((c) => (
            <AdminClinicCard key={c.clinicId} clinic={c} />
          ))}
        </div>
      )}

      <AdminPagination pathname={PATH} list={clinics} />
    </div>
  );
}
