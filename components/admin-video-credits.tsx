"use client";

import { useActionState } from "react";
import { adjustVideoCreditsAction, type ActionState } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

/** Saldo de videollamadas de una clínica y su ajuste (reembolso o cortesía) desde la consola. */
export function AdminVideoCredits({ clinicId, balance }: { clinicId: string; balance: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    adjustVideoCreditsAction.bind(null, clinicId),
    {},
  );

  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {balance} videollamada{balance === 1 ? "" : "s"} de saldo · Ajustar
      </summary>
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-muted-foreground">
          Ajuste
          <input
            name="delta"
            type="number"
            step={1}
            min={-100}
            max={100}
            required
            className="w-20 rounded-lg border border-input bg-background px-2 py-1 text-foreground"
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-muted-foreground">
          Motivo
          <input
            name="note"
            type="text"
            minLength={5}
            required
            className="rounded-lg border border-input bg-background px-2 py-1 text-foreground"
          />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        {state.error && <p className="w-full text-destructive">{state.error}</p>}
        {state.ok && <p className="w-full text-mint">Saldo ajustado.</p>}
      </form>
    </details>
  );
}
