"use client";

import { useActionState } from "react";
import { Save, Check } from "lucide-react";
import { updateDoctorNotesAction, type DoctorNotesState } from "@/app/(app)/consultations/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function DoctorNotesEditor({
  reportId,
  consultationId,
  notes,
}: {
  reportId: string;
  consultationId: string;
  notes: string | null;
}) {
  const action = updateDoctorNotesAction.bind(null, reportId, consultationId);
  const [state, formAction, pending] = useActionState<DoctorNotesState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <Textarea
        name="notes"
        rows={5}
        defaultValue={notes ?? ""}
        placeholder="Observaciones propias sobre la sesión, no visibles para el paciente ni generadas por IA…"
        className="bg-cloud/50"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <Save className="size-3.5" />
          {pending ? "Guardando…" : "Guardar notas"}
        </Button>
        {state.ok && (
          <span className="flex items-center gap-1 text-xs text-mint">
            <Check className="size-3.5" /> Guardado
          </span>
        )}
        {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
