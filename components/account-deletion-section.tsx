"use client";

import { useActionState, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import {
  cancelAccountDeletionAction,
  requestAccountDeletionAction,
  type AccountDeletionState,
} from "@/app/(app)/settings/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Misma comparación que requestAccountDeletionAction, que es la que vale. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("es-CO") === b.trim().toLocaleLowerCase("es-CO");
}

/**
 * Exportar y eliminar la cuenta (Términos de Vinculación, cláusula séptima).
 * Solo se muestra al admin de la clínica.
 */
export function AccountDeletionSection({
  clinicName,
  scheduledForLabel,
}: {
  clinicName: string;
  /** Fecha de supresión si hay una solicitud vigente; null si no hay. */
  scheduledForLabel: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  // Controlado a propósito: tras un envío React vacía los campos no
  // controlados del formulario, y eso borraba lo que se acababa de escribir.
  const [typed, setTyped] = useState("");
  const matches = sameName(typed, clinicName);
  const [requestState, requestAction, requesting] = useActionState<AccountDeletionState, FormData>(
    requestAccountDeletionAction,
    {},
  );
  const [cancelState, cancelAction, cancelling] = useActionState<AccountDeletionState, FormData>(
    cancelAccountDeletionAction,
    {},
  );

  return (
    <div className="space-y-4 rounded-2xl border border-gray-line bg-card p-5 md:p-6">
      <div>
        <h2 className="font-semibold text-navy">Exportar datos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Descarga todos tus pacientes con su historia clínica en un archivo JSON. Como responsable de
          las historias clínicas, debes conservarlas 15 años (Resolución 839 de 2017).
        </p>
        <a href="/settings/exportar" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`}>
          <Download className="size-4" />
          Exportar datos de la clínica
        </a>
      </div>

      <div className="border-t border-gray-line pt-4">
        <h2 className="font-heading font-semibold text-destructive">Eliminar la cuenta</h2>

        {scheduledForLabel ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm">
              La cuenta de <strong>{clinicName}</strong> se eliminará el{" "}
              <strong>{scheduledForLabel}</strong>, con todos sus pacientes y su información
              clínica. Exporta los datos antes de esa fecha. Puedes desistir hasta entonces.
            </p>
            <form action={cancelAction}>
              <Button type="submit" size="sm" disabled={cancelling}>
                {cancelling ? "Desistiendo…" : "Desistir de la eliminación"}
              </Button>
            </form>
            {cancelState.error && <p className="text-sm text-destructive">{cancelState.error}</p>}
          </div>
        ) : (
          <div className="mt-2 space-y-3 text-sm">
            <p className="text-muted-foreground">
              Tendrás 30 días para exportar tu información o desistir. Vencido ese plazo, se
              suprimen de forma definitiva los datos de la cuenta y de todos tus pacientes; solo se
              conservan los de identificación, auditoría y facturación que la ley exige. Si tienes
              un plan pago, no se renovará. Cancelar la suscripción no es lo mismo: no elimina la
              cuenta ni los datos.
            </p>
            {!confirming ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
                <Trash2 className="size-4" />
                Solicitar la eliminación
              </Button>
            ) : (
              <form action={requestAction} className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="confirmation">
                    Para confirmar, escribe el nombre de la clínica: <strong>{clinicName}</strong>
                  </Label>
                  <Input
                    id="confirmation"
                    name="confirmation"
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                </div>
                {requestState.error && <p className="text-destructive">{requestState.error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" variant="destructive" size="sm" disabled={requesting || !matches}>
                    {requesting ? "Registrando…" : "Eliminar la cuenta en 30 días"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
