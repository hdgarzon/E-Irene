"use client";

import { useActionState, useState } from "react";
import { revokeConsentAction, type RevokeConsentState } from "@/app/(app)/patients/[id]/actions";
import { Button } from "@/components/ui/button";

/** Registro de la revocación del consentimiento, pedida por el paciente. */
export function RevokeConsentForm({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RevokeConsentState, FormData>(
    revokeConsentAction.bind(null, patientId),
    {},
  );

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Registrar revocación
      </Button>
    );
  }

  return (
    <form action={action} className="mt-3 space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p>
        Si el paciente revoca su consentimiento, no podrás iniciar consultas ni transcribir hasta que
        firme de nuevo. La historia clínica ya registrada se conserva: la ley obliga a guardarla.
      </p>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">Nota (opcional): cómo y cuándo lo pidió</span>
        <textarea
          name="note"
          rows={2}
          maxLength={500}
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirm" required className="mt-0.5 size-4 accent-brand" />
        <span>El paciente (o su representante) pidió revocar su consentimiento.</span>
      </label>
      {state.error && <p className="text-destructive">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {pending ? "Registrando…" : "Registrar revocación"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
