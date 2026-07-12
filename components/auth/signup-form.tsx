"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type AuthState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VerifyCodeForm } from "@/components/auth/verify-code-form";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    signUpAction,
    {},
  );

  if (state.success && state.email) {
    return (
      <div className="space-y-4 text-center">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Revisa tu correo</h2>
          <p className="text-sm text-muted-foreground">
            Enviamos un código de 6 dígitos a <strong>{state.email}</strong>. Ingrésalo para
            confirmar tu cuenta y elegir una contraseña.
          </p>
        </div>
        <VerifyCodeForm email={state.email} />
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="clinicName">Nombre de la clínica</Label>
        <Input id="clinicName" name="clinicName" required placeholder="Consultorio Dra. Irene" />
        {state.fieldErrors?.clinicName && (
          <p className="text-sm text-destructive">{state.fieldErrors.clinicName}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fullName">Tu nombre completo</Label>
        <Input id="fullName" name="fullName" required placeholder="Irene Pérez" />
        {state.fieldErrors?.fullName && (
          <p className="text-sm text-destructive">{state.fieldErrors.fullName}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Correo electrónico</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        {state.fieldErrors?.email && (
          <p className="text-sm text-destructive">{state.fieldErrors.email}</p>
        )}
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Enviando enlace…" : "Crear cuenta gratis"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Iniciar sesión
        </Link>
      </p>
    </form>
  );
}
