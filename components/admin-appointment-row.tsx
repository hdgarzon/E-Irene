"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import {
  rescheduleAppointmentAction,
  setAppointmentStatusAdminAction,
  deleteAppointmentAdminAction,
} from "@/app/admin/actions";
import type { AdminAppointment } from "@/lib/db/platform-console";
import { toInputDateTime } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STATUS = [
  { value: "scheduled", label: "Agendada" },
  { value: "confirmed", label: "Confirmada" },
  { value: "completed", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
  { value: "no_show", label: "No asistió" },
];

export function AdminAppointmentRow({ appt }: { appt: AdminAppointment }) {
  const [pending, startTransition] = useTransition();
  const [when, setWhen] = useState(toInputDateTime(appt.scheduledAt));

  return (
    <tr className="border-b border-gray-line last:border-0 align-top">
      <td className="py-3 pr-3">
        <p className="font-medium text-navy">{appt.patientName}</p>
        <p className="text-xs text-muted-foreground">
          {appt.doctorName} · {appt.clinicName}
        </p>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-52"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                rescheduleAppointmentAction(appt.id, new Date(when).toISOString()),
              )
            }
          >
            <CalendarClock className="size-3.5" /> Reagendar
          </Button>
        </div>
      </td>
      <td className="px-3 py-3">
        <select
          value={appt.status}
          disabled={pending}
          onChange={(e) =>
            startTransition(() => setAppointmentStatusAdminAction(appt.id, e.target.value))
          }
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </td>
      <td className="py-3 pl-3 text-right">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            if (confirm("¿Eliminar esta cita?")) {
              startTransition(() => deleteAppointmentAdminAction(appt.id));
            }
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </td>
    </tr>
  );
}
