"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import type { ConsentState } from "@/app/(app)/patients/[id]/consent/actions";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Action = (prev: ConsentState, formData: FormData) => Promise<ConsentState>;

export function ConsentForm({
  action,
  defaultSignerName,
}: {
  action: Action;
  defaultSignerName?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ConsentState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="signerName">Nombre de quien firma *</Label>
        <Input
          id="signerName"
          name="signerName"
          defaultValue={defaultSignerName ?? ""}
          placeholder="Paciente o representante legal"
          required
        />
        {state.fieldErrors?.signerName && (
          <p className="text-sm text-destructive">{state.fieldErrors.signerName}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Firma *</Label>
        <SignaturePad name="signature" />
        {state.fieldErrors?.signature && (
          <p className="text-sm text-destructive">{state.fieldErrors.signature}</p>
        )}
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="accepted" className="mt-0.5 size-4 accent-purple" />
        <span>
          He leído y acepto el consentimiento informado, y autorizo el tratamiento de mis datos
          conforme a la Ley 1581 de 2012.
        </span>
      </label>
      {state.fieldErrors?.accepted && (
        <p className="text-sm text-destructive">{state.fieldErrors.accepted}</p>
      )}

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Firmar consentimiento"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
