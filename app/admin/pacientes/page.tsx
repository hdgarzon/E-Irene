import { listAllPatients } from "@/lib/db/platform-console";
import { AdminPatientRow } from "@/components/admin-patient-row";

export default async function AdminPacientesPage() {
  const patients = await listAllPatients();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Pacientes</h1>
        <p className="text-sm text-muted-foreground">
          {patients.length} {patients.length === 1 ? "paciente" : "pacientes"} en la plataforma.
          Editar datos de contacto o eliminar la cuenta. El contenido clínico (reportes, notas)
          no es accesible desde aquí.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        {patients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay pacientes registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-line text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Paciente</th>
                  <th className="px-3 pb-2 font-medium">Teléfono</th>
                  <th className="px-3 pb-2 font-medium">Clínica</th>
                  <th className="pb-2 pl-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => (
                  <AdminPatientRow key={p.id} patient={p} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
