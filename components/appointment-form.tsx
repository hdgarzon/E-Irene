"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentFormState } from "@/app/(app)/appointments/actions";
import type { DoctorOption } from "@/lib/db/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface PatientOption {
  id: string;
  fullName: string;
}

type Action = (
  prev: AppointmentFormState,
  formData: FormData,
) => Promise<AppointmentFormState>;

interface Defaults {
  patientId?: string;
  doctorId?: string;
  scheduledAt?: string; // "YYYY-MM-DDTHH:mm"
  durationMin?: number;
  notes?: string | null;
}

const selectClass =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function AppointmentForm({
  action,
  patients,
  doctors,
  defaults,
  submitLabel,
}: {
  action: Action;
  patients: PatientOption[];
  doctors: DoctorOption[];
  defaults?: Defaults;
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AppointmentFormState, FormData>(action, {});
  const d = defaults ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="patientId">Paciente *</Label>
        <select id="patientId" name="patientId" defaultValue={d.patientId ?? ""} className={selectClass} required>
          <option value="" disabled>
            Selecciona un paciente
          </option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
        {state.fieldErrors?.patientId && (
          <p className="text-sm text-destructive">{state.fieldErrors.patientId}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="doctorId">Profesional *</Label>
        <select id="doctorId" name="doctorId" defaultValue={d.doctorId ?? ""} className={selectClass} required>
          <option value="" disabled>
            Selecciona un profesional
          </option>
          {doctors.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.fullName}
            </option>
          ))}
        </select>
        {state.fieldErrors?.doctorId && (
          <p className="text-sm text-destructive">{state.fieldErrors.doctorId}</p>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="scheduledAt">Fecha y hora *</Label>
          <Input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            defaultValue={d.scheduledAt ?? ""}
            required
          />
          {state.fieldErrors?.scheduledAt && (
            <p className="text-sm text-destructive">{state.fieldErrors.scheduledAt}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="durationMin">Duración (min)</Label>
          <Input
            id="durationMin"
            name="durationMin"
            type="number"
            min={10}
            max={240}
            step={5}
            defaultValue={d.durationMin ?? 50}
          />
          {state.fieldErrors?.durationMin && (
            <p className="text-sm text-destructive">{state.fieldErrors.durationMin}</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Motivo / notas</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={d.notes ?? ""} />
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
