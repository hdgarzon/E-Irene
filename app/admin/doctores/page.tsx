import { listAllStaff } from "@/lib/db/platform-console";
import { AdminStaffRow } from "@/components/admin-staff-row";

export default async function AdminDoctoresPage() {
  const staff = await listAllStaff();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Doctores y personal</h1>
        <p className="text-sm text-muted-foreground">
          {staff.length} {staff.length === 1 ? "cuenta" : "cuentas"} de profesionales en la
          plataforma. Editar nombre/rol o eliminar la cuenta.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay profesionales registrados.</p>
        ) : (
          <ul className="divide-y divide-gray-line">
            {staff.map((s) => (
              <AdminStaffRow key={s.id} staff={s} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
