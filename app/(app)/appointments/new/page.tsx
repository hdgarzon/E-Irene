import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listPatients } from "@/lib/db/patients";
import { listDoctors } from "@/lib/db/clinic";
import { getSessionUser } from "@/lib/auth";
import { createAppointmentAction } from "@/app/(app)/appointments/actions";
import { AppointmentForm } from "@/components/appointment-form";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function NewAppointmentPage() {
  const [patients, doctors, user] = await Promise.all([
    listPatients(),
    listDoctors(),
    getSessionUser(),
  ]);

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
        <h1 className="font-heading text-2xl font-bold text-navy">Nueva cita</h1>
        <p className="text-sm text-muted-foreground">Agenda una sesión con un paciente.</p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        {patients.length === 0 ? (
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Primero necesitas registrar al menos un paciente.
            </p>
            <Link href="/patients/new" className={cn(buttonVariants(), "mt-4")}>
              Registrar paciente
            </Link>
          </div>
        ) : (
          <AppointmentForm
            action={createAppointmentAction}
            patients={patients.map((p) => ({ id: p.id, fullName: p.fullName }))}
            doctors={doctors}
            defaults={{ doctorId: user?.id, durationMin: 50 }}
            submitLabel="Agendar cita"
          />
        )}
      </div>
    </div>
  );
}
