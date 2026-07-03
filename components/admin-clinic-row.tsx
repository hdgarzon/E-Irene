"use client";

import { useTransition } from "react";
import { Building2, Users, Mic, Stethoscope, FileText, CalendarDays, Ban, RotateCcw } from "lucide-react";
import type { PlatformClinicOverview } from "@/lib/db/platform-admin";
import { setClinicPlanAction, setClinicSuspendedAction } from "@/app/admin/actions";
import { PLANS, type Plan } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PLAN_OPTIONS: Plan[] = ["free", "pro", "clinica", "enterprise"];

export function AdminClinicRow({ clinic }: { clinic: PlatformClinicOverview }) {
  const [pending, startTransition] = useTransition();
  const suspended = Boolean(clinic.suspendedAt);

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Building2 className="size-4 shrink-0 text-purple" />
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-navy">{clinic.clinicName}</p>
            {suspended && <Badge className="bg-destructive/15 text-destructive">Suspendida</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Registrada el {new Date(clinic.createdAt).toLocaleDateString("es-CO")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1" title="Doctores">
          <Stethoscope className="size-3.5" /> {clinic.doctorCount}
        </span>
        <span className="flex items-center gap-1" title="Pacientes">
          <Users className="size-3.5" /> {clinic.patientCount}
        </span>
        <span className="flex items-center gap-1" title="Consultas">
          <Mic className="size-3.5" /> {clinic.consultationCount}
        </span>
        <span className="flex items-center gap-1" title="Reportes">
          <FileText className="size-3.5" /> {clinic.reportCount}
        </span>
        <span className="flex items-center gap-1" title="Citas">
          <CalendarDays className="size-3.5" /> {clinic.appointmentCount}
        </span>

        <select
          aria-label="Plan"
          value={clinic.plan}
          disabled={pending}
          onChange={(e) =>
            startTransition(() => setClinicPlanAction(clinic.clinicId, e.target.value))
          }
          className="rounded-lg border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {PLAN_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {PLANS[p].label}
            </option>
          ))}
        </select>

        <Button
          type="button"
          size="sm"
          variant={suspended ? "outline" : "destructive"}
          disabled={pending}
          onClick={() =>
            startTransition(() => setClinicSuspendedAction(clinic.clinicId, !suspended))
          }
        >
          {suspended ? (
            <>
              <RotateCcw className="size-3.5" /> Reactivar
            </>
          ) : (
            <>
              <Ban className="size-3.5" /> Suspender
            </>
          )}
        </Button>
      </div>
    </li>
  );
}
