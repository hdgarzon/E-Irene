"use client";

import { ChevronDown } from "lucide-react";
import { setStatusAction } from "@/app/(app)/appointments/actions";
import type { AppointmentStatus } from "@/lib/db/appointments";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const META: Record<AppointmentStatus, { label: string; className: string }> = {
  scheduled: { label: "Agendada", className: "h-6 border-gray-line bg-cloud px-2.5 text-navy" },
  confirmed: { label: "Confirmada", className: "h-6 border-info-border bg-info-soft px-2.5 text-brand" },
  completed: { label: "Completada", className: "h-6 border-success-border bg-success-soft px-2.5 text-success" },
  cancelled: { label: "Cancelada", className: "h-6 border-danger-border bg-danger-soft px-2.5 text-destructive" },
  no_show: { label: "No asistió", className: "h-6 border-warning-border bg-warning-soft px-2.5 text-warning" },
};

const ORDER: AppointmentStatus[] = ["scheduled", "confirmed", "completed", "cancelled", "no_show"];

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge className={META[status].className}>{META[status].label}</Badge>;
}

export function AppointmentStatusMenu({
  id,
  status,
}: {
  id: string;
  status: AppointmentStatus;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <Badge className={`${META[status].className} cursor-pointer gap-1`}>
          {META[status].label}
          <ChevronDown className="size-3" />
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {ORDER.map((s) => (
          <form key={s} action={setStatusAction}>
            <input type="hidden" name="appointmentId" value={id} />
            <input type="hidden" name="status" value={s} />
            <DropdownMenuItem
              nativeButton
              render={<button type="submit" className="w-full" />}
              disabled={s === status}
            >
              {META[s].label}
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
