import Link from "next/link";
import { CalendarDays, Clock, Pencil, Plus, User } from "lucide-react";
import { listAppointments } from "@/lib/db/appointments";
import { groupByDay, formatTime } from "@/lib/dates";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppointmentStatusMenu } from "@/components/appointment-status";
import { ReminderButton } from "@/components/reminder-button";
import { StartVideoButton } from "@/components/start-video-button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export default async function AppointmentsPage() {
  const appointments = await listAppointments();
  const groups = groupByDay(appointments);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Agenda"
        description={
          <>
            {appointments.length} {appointments.length === 1 ? "cita" : "citas"} en total
          </>
        }
        actions={
          <Link href="/appointments/new" className={cn(buttonVariants())}>
            <Plus className="size-4" />
            Nueva cita
          </Link>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No hay citas agendadas"
          description="Agenda la primera cita para empezar a organizar tu consulta."
          action={
            <Link href="/appointments/new" className={cn(buttonVariants())}>
              <Plus className="size-4" />
              Agendar cita
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}
              </h2>
              <div className="divide-y divide-gray-line overflow-hidden rounded-2xl border border-gray-line bg-card">
                {group.items.map((appt) => (
                  <div key={appt.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                    <div className="flex w-14 shrink-0 flex-col items-start">
                      <span className="text-lg font-semibold tabular-nums text-navy">
                        {formatTime(appt.scheduledAt)}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {appt.durationMin}m
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-navy">{appt.patientName}</p>
                      <p className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                        <User className="size-3.5 shrink-0" />
                        <span className="truncate">{appt.doctorName}</span>
                      </p>
                    </div>

                    {/* En móvil las acciones bajan a su propia fila: el nombre del
                        paciente es lo que hay que poder leer completo. */}
                    <div className="flex w-full items-center justify-end gap-1 sm:w-auto sm:gap-2">
                      <AppointmentStatusMenu id={appt.id} status={appt.status} />

                      <ReminderButton appointmentId={appt.id} />

                      {appt.modality === "video" &&
                        appt.status !== "cancelled" &&
                        appt.status !== "completed" && <StartVideoButton appointmentId={appt.id} />}

                      <Link
                        href={`/appointments/${appt.id}/edit`}
                        className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-cloud hover:text-brand"
                        aria-label="Editar cita"
                      >
                        <Pencil className="size-4" />
                      </Link>
                    </div>
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
