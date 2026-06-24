"use client";

import { useActionState } from "react";
import { Pencil, Check } from "lucide-react";
import { updateSuggestionAction, type SuggestionState } from "@/app/(app)/consultations/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function SuggestionEditor({
  reportId,
  consultationId,
  suggestion,
  doctorEdited,
}: {
  reportId: string;
  consultationId: string;
  suggestion: string;
  doctorEdited: boolean;
}) {
  const action = updateSuggestionAction.bind(null, reportId, consultationId);
  const [state, formAction, pending] = useActionState<SuggestionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <Textarea name="suggestion" rows={5} defaultValue={suggestion} className="bg-cloud/50" />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <Pencil className="size-3.5" />
          {pending ? "Guardando…" : "Guardar sugerencia"}
        </Button>
        {state.ok && (
          <span className="flex items-center gap-1 text-xs text-mint">
            <Check className="size-3.5" /> Guardado
          </span>
        )}
        {doctorEdited && !state.ok && (
          <span className="text-xs text-muted-foreground">Editada por el profesional</span>
        )}
        {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
