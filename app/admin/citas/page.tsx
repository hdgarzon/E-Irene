import { listAllAppointments } from "@/lib/db/platform-console";
import { describeListPage, readListParams } from "@/lib/admin-list";
import { AdminAppointmentRow } from "@/components/admin-appointment-row";
import { AdminPagination, AdminSearchForm } from "@/components/admin-list-controls";

const PATH = "/admin/citas";

export default async function AdminCitasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const appointments = await listAllAppointments(readListParams(await searchParams));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Citas</h1>
        <p data-testid="list-summary" className="text-sm text-muted-foreground">
          Agenda de todas las clínicas —{" "}
          {describeListPage(appointments, { singular: "cita", plural: "citas" })}. Reagendar,
          cambiar estado o cancelar.
        </p>
      </div>

      <AdminSearchForm
        action={PATH}
        query={appointments.query}
        label="Buscar citas por clínica"
        placeholder="Buscar por clínica…"
      />

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        {appointments.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {appointments.query
              ? `Ninguna cita de una clínica que coincida con "${appointments.query}".`
              : "Aún no hay citas registradas."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-line text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Profesional / Clínica</th>
                  <th className="px-3 pb-2 font-medium">Fecha y hora</th>
                  <th className="px-3 pb-2 font-medium">Estado</th>
                  <th className="pb-2 pl-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {appointments.items.map((a) => (
                  <AdminAppointmentRow key={a.id} appt={a} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AdminPagination pathname={PATH} list={appointments} />
    </div>
  );
}
