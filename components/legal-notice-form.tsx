"use client";

import { useActionState } from "react";
import { createLegalNoticeAction, type NoticeState } from "@/app/admin/avisos/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LegalNoticeForm({ minDate }: { minDate: string }) {
  const [state, action, pending] = useActionState<NoticeState, FormData>(createLegalNoticeAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Título</Label>
        <Input id="title" name="title" placeholder="Actualización de la Política de Tratamiento" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="body">Qué cambia</Label>
        <textarea
          id="body"
          name="body"
          rows={5}
          required
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="effectiveDate">Entra en vigor el</Label>
        <Input id="effectiveDate" name="effectiveDate" type="date" min={minDate} defaultValue={minDate} required />
        <p className="text-xs text-muted-foreground">
          Mínimo 15 días hábiles de aviso (sin fines de semana ni festivos de Colombia).
        </p>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && <p className="text-sm text-mint">{state.ok}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Publicando…" : "Publicar aviso"}
      </Button>
    </form>
  );
}
