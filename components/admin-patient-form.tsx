"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { updatePatientAdminAction, type ActionState } from "@/app/admin/actions";
import type { AdminPatient } from "@/lib/db/platform-console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminPatientForm({ patient }: { patient: AdminPatient }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updatePatientAdminAction.bind(null, patient.id),
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="fullName">Nombre completo *</Label>
        <Input id="fullName" name="fullName" defaultValue={patient.fullName} required />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="document">Documento</Label>
          <Input id="document" name="document" defaultValue={patient.document ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" defaultValue={patient.phone ?? ""} inputMode="tel" />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo</Label>
          <Input id="email" name="email" type="email" defaultValue={patient.email ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="birthDate">Fecha de nacimiento</Label>
          <Input id="birthDate" name="birthDate" type="date" defaultValue={patient.birthDate ?? ""} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="gender">Género</Label>
        <select
          id="gender"
          name="gender"
          defaultValue={patient.gender ?? ""}
          className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Sin especificar</option>
          <option value="F">Femenino</option>
          <option value="M">Masculino</option>
          <option value="O">Otro</option>
        </select>
      </div>

      <div className="space-y-3 rounded-xl border border-gray-line p-4">
        <p className="text-sm font-medium text-navy">Contacto de emergencia</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactName">Nombre</Label>
            <Input
              id="emergencyContactName"
              name="emergencyContactName"
              defaultValue={patient.emergencyContactName ?? ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emergencyContactPhone">Teléfono</Label>
            <Input
              id="emergencyContactPhone"
              name="emergencyContactPhone"
              defaultValue={patient.emergencyContactPhone ?? ""}
              inputMode="tel"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergencyContactRelationship">Parentesco</Label>
          <Input
            id="emergencyContactRelationship"
            name="emergencyContactRelationship"
            defaultValue={patient.emergencyContactRelationship ?? ""}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        🔒 Solo datos de identidad y contacto. Las notas clínicas y antecedentes no se muestran ni
        modifican desde el panel de plataforma.
      </p>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar cambios"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/pacientes")}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
