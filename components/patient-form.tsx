"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { PatientFormState } from "@/app/(app)/patients/actions";
import type { Patient } from "@/lib/db/patient-mappers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Action = (prev: PatientFormState, formData: FormData) => Promise<PatientFormState>;

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-sm text-destructive">{msg}</p>;
}

export function PatientForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: Action;
  defaultValues?: Partial<Patient>;
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<PatientFormState, FormData>(action, {});
  const d = defaultValues ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Nombre completo *</Label>
        <Input id="fullName" name="fullName" defaultValue={d.fullName ?? ""} required />
        <FieldError msg={state.fieldErrors?.fullName} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="document">Documento</Label>
          <Input id="document" name="document" defaultValue={d.document ?? ""} placeholder="CC / TI / CE" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" defaultValue={d.phone ?? ""} inputMode="tel" />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" defaultValue={d.email ?? ""} />
          <FieldError msg={state.fieldErrors?.email} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birthDate">Fecha de nacimiento</Label>
          <Input id="birthDate" name="birthDate" type="date" defaultValue={d.birthDate ?? ""} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gender">Género</Label>
        <select
          id="gender"
          name="gender"
          defaultValue={d.gender ?? ""}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Sin especificar</option>
          <option value="F">Femenino</option>
          <option value="M">Masculino</option>
          <option value="O">Otro</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Notas clínicas iniciales</Label>
        <Textarea id="notes" name="notes" rows={4} defaultValue={d.notes ?? ""} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="history">Antecedentes básicos</Label>
        <Textarea
          id="history"
          name="history"
          rows={3}
          defaultValue={d.history ?? ""}
          placeholder="Alergias, medicación actual, diagnósticos o tratamientos previos…"
        />
      </div>

      <div className="space-y-3 rounded-xl border border-gray-line p-4">
        <p className="text-sm font-medium text-navy">Contacto de emergencia</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactName">Nombre</Label>
            <Input
              id="emergencyContactName"
              name="emergencyContactName"
              defaultValue={d.emergencyContactName ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactPhone">Teléfono</Label>
            <Input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              defaultValue={d.emergencyContactPhone ?? ""}
              inputMode="tel"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergencyContactRelationship">Parentesco / relación</Label>
          <Input
            id="emergencyContactRelationship"
            name="emergencyContactRelationship"
            defaultValue={d.emergencyContactRelationship ?? ""}
            placeholder="Madre, pareja, amigo…"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        🔒 Toda la información del paciente se guarda cifrada (AES-256).
      </p>

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
