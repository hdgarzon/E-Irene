"use client";

import { useActionState } from "react";
import Link from "next/link";
import { acceptPolicyAction, type AcceptState } from "@/app/terminos/actions";
import { Button } from "@/components/ui/button";

export function AcceptPolicyForm() {
  const [state, formAction, pending] = useActionState<AcceptState, FormData>(
    acceptPolicyAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {/* Sin `defaultChecked`: una casilla premarcada no constituye
          autorización válida bajo la Ley 1581. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-line p-4 transition-colors hover:bg-cloud">
        <input
          type="checkbox"
          name="accepted"
          required
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span className="text-sm">
          He leído y acepto el{" "}
          <Link href="/privacidad" target="_blank" className="text-primary hover:underline">
            aviso de privacidad
          </Link>{" "}
          y la política de tratamiento de datos personales, y autorizo a E-Irene S.A.S. a tratar
          mis datos para las finalidades allí descritas, incluida la verificación de mi
          habilitación profesional ante fuentes públicas oficiales.
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-line p-4 transition-colors hover:bg-cloud">
        <input type="checkbox" name="marketing" className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span className="text-sm">
          Quiero recibir comunicaciones sobre novedades y funcionalidades de la plataforma.
          <span className="block text-xs text-muted-foreground">
            Opcional. Puedes retirar esta autorización en cualquier momento.
          </span>
        </span>
      </label>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Registrando…" : "Aceptar y continuar"}
      </Button>
    </form>
  );
}
