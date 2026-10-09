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
  requiresRepresentativeByBirthDate,
  askMinorAssent = false,
}: {
  action: Action;
  defaultSignerName?: string;
  /**
   * true si por la edad (menor de 14) firma el representante legal; false si
   * el paciente puede firmar por sí mismo; null si no hay fecha de nacimiento.
   */
  requiresRepresentativeByBirthDate: boolean | null;
  /**
   * Pide registrar el asentimiento del menor. Solo en el flujo del profesional:
   * el asentimiento lo evalúa él en la consulta, no quien abre el enlace.
   */
  askMinorAssent?: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ConsentState, FormData>(action, {});
  const [substitute, setSubstitute] = useState(false);
  const minorMode = requiresRepresentativeByBirthDate === true || substitute;

  return (
    <form action={formAction} className="space-y-5">
      {requiresRepresentativeByBirthDate === true ? (
        <>
          <input type="hidden" name="isMinor" value="on" />
          <div className="flex items-start gap-3 rounded-2xl border border-coral/30 bg-coral/5 p-4">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <p className="text-sm text-foreground/90">
              <span className="font-semibold text-navy">Paciente menor de 14 años.</span> Según su
              fecha de nacimiento registrada, la autorización la otorga su representante legal, y el
              profesional registra el asentimiento del menor (Resolución 309 de 2025).
            </p>
          </div>
        </>
      ) : (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            name="isMinor"
            checked={substitute}
            onChange={(e) => setSubstitute(e.target.checked)}
            className="mt-0.5 size-4 accent-brand"
          />
          <span>
            Firma el representante legal
            {requiresRepresentativeByBirthDate === null
              ? " (paciente menor de 14 años sin fecha de nacimiento registrada, o que requiere consentimiento sustituto)."
              : " (el paciente requiere consentimiento sustituto). Desde los 14 años el paciente puede firmar por sí mismo."}
          </span>
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

      {minorMode && askMinorAssent && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">¿El menor manifestó su asentimiento? *</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="minorAssent" value="yes" className="accent-brand" /> Sí
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="minorAssent" value="no" className="accent-brand" /> No
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Registre en la historia clínica el criterio de valoración de capacidad utilizado
            (comunicación de la decisión, comprensión, razonamiento y juicio).
          </p>
          {state.fieldErrors?.minorAssent && (
            <p className="text-sm text-destructive">{state.fieldErrors.minorAssent}</p>
          )}
        </fieldset>
      )}

      <div className="space-y-1.5">
        <Label>Firma *</Label>
        <SignaturePad name="signature" />
        {state.fieldErrors?.signature && (
          <p className="text-sm text-destructive">{state.fieldErrors.signature}</p>
        )}
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name="accepted" className="mt-0.5 size-4 accent-brand" />
        <span>
          {minorMode
            ? "Declaro ser el representante legal del paciente identificado y, en su nombre, he leído y acepto el consentimiento informado, y autorizo de forma libre, previa, expresa e informada el tratamiento de sus datos personales, incluidos sus datos de salud, y la transferencia internacional descrita."
            : "He leído y acepto el consentimiento informado, y autorizo de forma libre, previa, expresa e informada el tratamiento de mis datos personales, incluidos mis datos de salud, y la transferencia internacional descrita."}
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
