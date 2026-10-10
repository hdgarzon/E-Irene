"use client";

import { useActionState } from "react";
import { acceptPolicyAction, type AcceptState } from "@/app/terminos/actions";
import { Button } from "@/components/ui/button";
import { ProfessionalAcceptanceFields } from "@/components/professional-acceptance-fields";

export function AcceptPolicyForm() {
  const [state, formAction, pending] = useActionState<AcceptState, FormData>(
    acceptPolicyAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <ProfessionalAcceptanceFields />

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
