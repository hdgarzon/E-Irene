"use client";

import { useActionState } from "react";
import { setPasswordAction, type SetPasswordState } from "@/app/auth/set-password/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetPasswordForm({
  clinicName,
  fullName,
}: {
  clinicName: string;
  fullName: string;
}) {
  const [state, formAction, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="clinicName">Nombre de la clínica</Label>
        <Input id="clinicName" name="clinicName" required defaultValue={clinicName} />
        {state.fieldErrors?.clinicName && (
          <p className="text-sm text-destructive">{state.fieldErrors.clinicName}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fullName">Tu nombre completo</Label>
        <Input id="fullName" name="fullName" required defaultValue={fullName} />
        {state.fieldErrors?.fullName && (
          <p className="text-sm text-destructive">{state.fieldErrors.fullName}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Contraseña</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
        {state.fieldErrors?.password && (
          <p className="text-sm text-destructive">{state.fieldErrors.password}</p>
        )}
        <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Guardando…" : "Guardar y entrar"}
      </Button>
    </form>
  );
}
