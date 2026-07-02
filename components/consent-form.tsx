"use client";

import { useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import type { ConsentState } from "@/app/(app)/patients/[id]/consent/actions";
import { SignaturePad } from "@/components/signature-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Action = (prev: ConsentState, formData: FormData) => Promise<ConsentState>;

export function ConsentForm({
  action,
  defaultSignerName,
  isMinorByBirthDate,
}: {
  action: Action;
  defaultSignerName?: string;
  /** true/false si se conoce la fecha de nacimiento; null si no se conoce. */
  isMinorByBirthDate: boolean | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ConsentState, FormData>(action, {});
  const [manualMinor, setManualMinor] = useState(false);
  const minorMode = isMinorByBirthDate === true || manualMinor;

  return (
    <form action={formAction} className="space-y-5">
      {isMinorByBirthDate === true && (
        <>
          <input type="hidden" name="isMinor" value="on" />
          <div className="flex items-start gap-3 rounded-2xl border border-coral/30 bg-coral/5 p-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <p className="text-sm text-foreground/90">
              <span className="font-semibold text-navy">Paciente menor de edad.</span> Según su
              fecha de nacimiento registrada, se requiere el consentimiento de su representante
              legal (Ley 1098 de 2006).
            </p>
          </div>
        </>
      )}

      {isMinorByBirthDate === null && (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="isMinor"
            checked={manualMinor}
            onChange={(e) => setManualMinor(e.target.checked)}
            className="mt-0.5 size-4 accent-purple"
          />
          <span>Este paciente es menor de edad (no hay fecha de nacimiento registrada).</span>
        </label>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="signerName">
          {minorMode ? "Nombre del representante legal *" : "Nombre de quien firma *"}
        </Label>
        <Input
          id="signerName"
          name="signerName"
          defaultValue={defaultSignerName ?? ""}
          placeholder={minorMode ? "Nombre completo del representante legal" : "Paciente o representante legal"}
          required
        />
        {state.fieldErrors?.signerName && (
          <p className="text-sm text-destructive">{state.fieldErrors.signerName}</p>
        )}
      </div>

      {minorMode && (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="representativeDocument">Documento del representante *</Label>
            <Input id="representativeDocument" name="representativeDocument" placeholder="CC" />
            {state.fieldErrors?.representativeDocument && (
              <p className="text-sm text-destructive">{state.fieldErrors.representativeDocument}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="representativeRelationship">Parentesco *</Label>
            <select
              id="representativeRelationship"
              name="representativeRelationship"
              defaultValue=""
              className="flex h-9 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="" disabled>
                Selecciona…
              </option>
              <option value="Madre">Madre</option>
              <option value="Padre">Padre</option>
              <option value="Tutor legal">Tutor legal</option>
              <option value="Otro">Otro</option>
            </select>
            {state.fieldErrors?.representativeRelationship && (
              <p className="text-sm text-destructive">{state.fieldErrors.representativeRelationship}</p>
            )}
          </div>
        </div>
      )}

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
          {minorMode
            ? "Declaro ser el representante legal del paciente menor de edad identificado y, en su nombre, he leído y acepto el consentimiento informado, autorizando el tratamiento de sus datos conforme a la Ley 1581 de 2012."
            : "He leído y acepto el consentimiento informado, y autorizo el tratamiento de mis datos conforme a la Ley 1581 de 2012."}
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
