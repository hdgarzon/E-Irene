"use client";

import { useTransition } from "react";
import { Building2, Users, Ban, RotateCcw, Stethoscope } from "lucide-react";
import type { ClinicMapEntry } from "@/lib/db/platform-console";
import { setClinicPlanAction, setClinicSuspendedAction } from "@/app/admin/actions";
import { PLANS, type Plan } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const PLAN_OPTIONS: Plan[] = ["free", "pro", "clinica", "enterprise"];

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  doctor: "Doctor",
  secretaria: "Secretaría",
  paciente: "Paciente",
};

export function AdminClinicCard({ clinic }: { clinic: ClinicMapEntry }) {
  const [pending, startTransition] = useTransition();

  return (
    <div data-testid="clinic-card" className="rounded-2xl border border-gray-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-purple/15 text-purple">
            <Building2 className="size-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-heading font-semibold text-navy">{clinic.clinicName}</p>
              {clinic.suspended && (
                <Badge className="bg-destructive/15 text-destructive">Suspendida</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {clinic.doctors.length} profesional{clinic.doctors.length === 1 ? "" : "es"} ·{" "}
              {clinic.patientCount} paciente{clinic.patientCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
            variant={clinic.suspended ? "outline" : "destructive"}
            disabled={pending}
            onClick={() =>
              startTransition(() => setClinicSuspendedAction(clinic.clinicId, !clinic.suspended))
            }
          >
            {clinic.suspended ? <RotateCcw className="size-3.5" /> : <Ban className="size-3.5" />}
            {clinic.suspended ? "Reactivar" : "Suspender"}
          </Button>
        </div>
      </div>

      {clinic.doctors.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-gray-line pt-3">
          {clinic.doctors.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-navy">
                <Stethoscope className="size-3.5 text-muted-foreground" />
                {d.fullName}
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {d.email}
                <Badge className="bg-muted text-foreground/70">{ROLE_LABEL[d.role] ?? d.role}</Badge>
              </span>
            </div>
          ))}
        </div>
      )}

      {clinic.doctors.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 border-t border-gray-line pt-3 text-xs text-muted-foreground">
          <Users className="size-3.5" /> Sin profesionales registrados.
        </p>
      )}
    </div>
  );
}
