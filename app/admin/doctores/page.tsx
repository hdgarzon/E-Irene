import { listAllStaff } from "@/lib/db/platform-console";
import { describeListPage, readListParams } from "@/lib/admin-list";
import { AdminStaffRow } from "@/components/admin-staff-row";
import { AdminPagination, AdminSearchForm } from "@/components/admin-list-controls";

const PATH = "/admin/doctores";

export default async function AdminDoctoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await listAllStaff(readListParams(await searchParams));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Doctores y personal</h1>
        <p data-testid="list-summary" className="text-sm text-muted-foreground">
          {describeListPage(staff, { singular: "cuenta de profesional", plural: "cuentas de profesionales" })}
          . Las más recientes primero. Editar nombre/rol o eliminar la cuenta.
        </p>
      </div>

      <AdminSearchForm
        action={PATH}
        query={staff.query}
        label="Buscar profesional"
        placeholder="Buscar por nombre o correo…"
      />

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        {staff.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {staff.query
              ? `Ningún profesional coincide con "${staff.query}".`
              : "Aún no hay profesionales registrados."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-line">
            {staff.items.map((s) => (
              <AdminStaffRow key={s.id} staff={s} />
            ))}
          </ul>
        )}
      </div>

      <AdminPagination pathname={PATH} list={staff} />
    </div>
  );
}
