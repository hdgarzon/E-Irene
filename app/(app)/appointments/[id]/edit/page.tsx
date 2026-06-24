import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAppointment } from "@/lib/db/appointments";
import { listPatients } from "@/lib/db/patients";
import { listDoctors } from "@/lib/db/clinic";
import { updateAppointmentAction } from "@/app/(app)/appointments/actions";
import { AppointmentForm } from "@/components/appointment-form";
import { toInputDateTime } from "@/lib/dates";

export default async function EditAppointmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [appt, patients, doctors] = await Promise.all([
    getAppointment(id),
    listPatients(),
    listDoctors(),
  ]);
  if (!appt) notFound();

  const action = updateAppointmentAction.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/appointments"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a la agenda
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Editar cita</h1>
        <p className="text-sm text-muted-foreground">{appt.patientName}</p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <AppointmentForm
          action={action}
          patients={patients.map((p) => ({ id: p.id, fullName: p.fullName }))}
          doctors={doctors}
          defaults={{
            patientId: appt.patientId,
            doctorId: appt.doctorId,
            scheduledAt: toInputDateTime(appt.scheduledAt),
            durationMin: appt.durationMin,
            notes: appt.notes,
          }}
          submitLabel="Guardar cambios"
        />
      </div>
    </div>
  );
}
