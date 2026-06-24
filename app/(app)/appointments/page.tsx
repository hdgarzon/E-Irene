import Link from "next/link";
import { CalendarDays, Clock, Pencil, Plus, User } from "lucide-react";
import { listAppointments } from "@/lib/db/appointments";
import { groupByDay, formatTime } from "@/lib/dates";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppointmentStatusMenu } from "@/components/appointment-status";

export default async function AppointmentsPage() {
  const appointments = await listAppointments();
  const groups = groupByDay(appointments);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">Agenda</h1>
          <p className="text-sm text-muted-foreground">
            {appointments.length} {appointments.length === 1 ? "cita" : "citas"} en total
          </p>
        </div>
        <Link href="/appointments/new" className={cn(buttonVariants())}>
          <Plus className="size-4" />
          Nueva cita
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <CalendarDays className="size-6 text-purple" />
          </div>
          <h3 className="font-heading font-semibold text-navy">No hay citas agendadas</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Agenda la primera cita para empezar a organizar tu consulta.
          </p>
          <Link href="/appointments/new" className={cn(buttonVariants(), "mt-5")}>
            <Plus className="size-4" />
            Agendar cita
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground first-letter:uppercase">
                {group.label}
              </h2>
              <div className="divide-y divide-gray-line overflow-hidden rounded-2xl border border-gray-line bg-card">
                {group.items.map((appt) => (
                  <div key={appt.id} className="flex items-center gap-4 p-4">
                    <div className="flex w-16 shrink-0 flex-col items-center">
                      <span className="font-heading text-lg font-bold text-navy">
                        {formatTime(appt.scheduledAt)}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {appt.durationMin}m
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-navy">{appt.patientName}</p>
                      <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                        <User className="size-3.5" />
                        {appt.doctorName}
                      </p>
                    </div>

                    <AppointmentStatusMenu id={appt.id} status={appt.status} />

                    <Link
                      href={`/appointments/${appt.id}/edit`}
                      className="text-muted-foreground hover:text-purple"
                      aria-label="Editar cita"
                    >
                      <Pencil className="size-4" />
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
