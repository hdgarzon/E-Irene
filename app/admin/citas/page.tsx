import { listAllAppointments } from "@/lib/db/platform-console";
import { AdminAppointmentRow } from "@/components/admin-appointment-row";

export default async function AdminCitasPage() {
  const appointments = await listAllAppointments();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Citas</h1>
        <p className="text-sm text-muted-foreground">
          Agenda de todas las clínicas — {appointments.length}{" "}
          {appointments.length === 1 ? "cita" : "citas"}. Reagendar, cambiar estado o cancelar.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        {appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay citas registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-line text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Paciente</th>
                  <th className="px-3 pb-2 font-medium">Fecha y hora</th>
                  <th className="px-3 pb-2 font-medium">Estado</th>
                  <th className="pb-2 pl-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <AdminAppointmentRow key={a.id} appt={a} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
