"use client";

import { useActionState } from "react";
import { Save, Check, NotebookText } from "lucide-react";
import { saveSoapNoteAction, type SoapNoteState } from "@/app/(app)/consultations/actions";
import type { SoapNote } from "@/lib/db/soap-notes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const FIELDS: { name: keyof SoapNote & string; label: string; placeholder: string }[] = [
  { name: "subjective", label: "S — Subjetivo", placeholder: "Lo que el paciente refiere, en sus propias palabras…" },
  { name: "objective", label: "O — Objetivo", placeholder: "Observaciones del profesional durante la sesión…" },
  { name: "assessment", label: "A — Análisis", placeholder: "Impresión clínica del profesional…" },
  { name: "plan", label: "P — Plan", placeholder: "Siguientes pasos, tareas, próxima cita…" },
];

export function SoapNoteEditor({
  consultationId,
  patientId,
  note,
}: {
  consultationId: string;
  patientId: string;
  note: SoapNote | null;
}) {
  const action = saveSoapNoteAction.bind(null, consultationId, patientId);
  const [state, formAction, pending] = useActionState<SoapNoteState, FormData>(action, {});

  return (
    <div className="rounded-2xl border border-gray-line bg-card p-6">
      <div className="mb-1 flex items-center gap-2 font-heading font-semibold text-navy">
        <NotebookText className="size-4 text-purple" />
        Nota SOAP
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Formato clínico estándar, escrito por ti — complementario al análisis de IA.
      </p>
      <form action={formAction} className="space-y-4">
        {FIELDS.map((f) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={f.name}>{f.label}</Label>
            <Textarea
              id={f.name}
              name={f.name}
              rows={3}
              defaultValue={note?.[f.name] ?? ""}
              placeholder={f.placeholder}
            />
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            <Save className="size-3.5" />
            {pending ? "Guardando…" : "Guardar nota SOAP"}
          </Button>
          {state.ok && (
            <span className="flex items-center gap-1 text-xs text-mint">
              <Check className="size-3.5" /> Guardado
            </span>
          )}
          {state.error && <span className="text-xs text-destructive">{state.error}</span>}
        </div>
      </form>
    </div>
  );
}
