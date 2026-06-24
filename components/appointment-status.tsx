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
  scheduled: { label: "Agendada", className: "bg-secondary text-secondary-foreground" },
  confirmed: { label: "Confirmada", className: "bg-purple/15 text-purple" },
  completed: { label: "Completada", className: "bg-mint/15 text-[#04342a]" },
  cancelled: { label: "Cancelada", className: "bg-destructive/15 text-destructive" },
  no_show: { label: "No asistió", className: "bg-muted text-muted-foreground" },
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
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
