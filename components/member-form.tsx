"use client";

import { useActionState, useEffect, useRef } from "react";
import { addMemberAction, type MemberState } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass =
  "flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function MemberForm() {
  const [state, formAction, pending] = useActionState<MemberState, FormData>(
    addMemberAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Nombre completo</Label>
          <Input id="fullName" name="fullName" required />
          {state.fieldErrors?.fullName && (
            <p className="text-sm text-destructive">{state.fieldErrors.fullName}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Rol</Label>
          <select id="role" name="role" className={selectClass} defaultValue="doctor">
            <option value="doctor">Profesional</option>
            <option value="secretaria">Secretaría</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" required />
          {state.fieldErrors?.email && (
            <p className="text-sm text-destructive">{state.fieldErrors.email}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Contraseña temporal</Label>
          <Input id="password" name="password" type="text" required />
          {state.fieldErrors?.password && (
            <p className="text-sm text-destructive">{state.fieldErrors.password}</p>
          )}
        </div>
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p className="rounded-md bg-mint/15 px-3 py-2 text-sm text-[#04342a]">
          Miembro agregado. Comparte la contraseña temporal de forma segura.
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Agregando…" : "Agregar miembro"}
      </Button>
    </form>
  );
}
