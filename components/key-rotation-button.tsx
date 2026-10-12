"use client";

import { useActionState } from "react";
import { runKeyRotationAction, type RotationState } from "@/app/admin/rotacion-clave/actions";
import { Button } from "@/components/ui/button";

export function KeyRotationButton() {
  const [state, action, pending] = useActionState<RotationState, FormData>(runKeyRotationAction, {});
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Recifrando… (hasta 4 minutos)" : "Recifrar ahora"}
      </Button>
      {state.run && (
        <p className="text-sm text-muted-foreground">
          Pasada terminada: {state.run.reencrypted} valores recifrados, {state.run.reindexed} pacientes
          reindexados, {state.run.failed} ilegibles.
          {state.run.timedOut ? " Se cortó por tiempo: vuelve a pulsar para continuar." : ""}
        </p>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
