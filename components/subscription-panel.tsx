"use client";

import { useActionState } from "react";
import { CalendarClock, CircleAlert, RotateCcw } from "lucide-react";
import {
  cancelSubscriptionAction,
  revertCancellationAction,
  type SubscriptionState,
} from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Estado de la suscripción paga. Las fechas llegan formateadas desde el
 * servidor, en hora de Bogotá: el navegador puede estar en otra zona y la fecha
 * de corte que vale es la de Colombia.
 */
export type SubscriptionPanelState =
  /** Período pagado vigente que se va a renovar. */
  | { kind: "renewing"; periodEnd: string }
  /** Cancelación pedida: conserva el plan hasta periodEnd. */
  | { kind: "canceling"; periodEnd: string }
  /** Sin período pagado vigente: cancelar la termina de inmediato. */
  | { kind: "unpaid"; lapsedOn: string | null };

const initialState: SubscriptionState = {};

export function SubscriptionPanel({
  planLabel,
  state,
  freeLimits,
  canManage,
}: {
  planLabel: string;
  state: SubscriptionPanelState;
  /** Qué incluye Free, para que quien cancela sepa a qué pasa. */
  freeLimits: string;
  /** Solo el admin de la clínica cancela o reactiva. */
  canManage: boolean;
}) {
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelSubscriptionAction,
    initialState,
  );
  const [revertState, revertAction, revertPending] = useActionState(
    revertCancellationAction,
    initialState,
  );

  return (
    <section id="suscripcion" className="rounded-2xl border border-gray-line bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cloud">
          <CalendarClock className="size-4 text-brand" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-heading font-semibold text-navy">Suscripción</h2>
          {state.kind === "renewing" && (
            <p className="text-sm text-foreground/90">
              Plan {planLabel} · se renueva el {state.periodEnd}. Puedes cancelar cuando quieras y
              conservas el plan hasta esa fecha.
            </p>
          )}
          {state.kind === "canceling" && (
            <p className="text-sm text-foreground/90">
              Cancelaste la suscripción. Conservas el plan {planLabel} hasta el {state.periodEnd} y
              no se te vuelve a cobrar. Ese día tu clínica pasa a Free; no se borra ningún paciente,
              historia clínica ni reporte.
            </p>
          )}
          {state.kind === "unpaid" && (
            <p className="text-sm text-foreground/90">
              {state.lapsedOn
                ? `La renovación del plan ${planLabel} del ${state.lapsedOn} está pendiente de pago.`
                : `El plan ${planLabel} no tiene un período pagado vigente.`}
            </p>
          )}
          {!canManage && (
            <p className="text-xs text-muted-foreground">
              Solo el administrador de la clínica puede cancelar o reactivar la suscripción.
            </p>
          )}
        </div>
      </div>

      {canManage && state.kind === "canceling" && (
        <form action={revertAction} className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={revertPending}>
            <RotateCcw className="size-3.5" />
            {revertPending ? "Reactivando…" : "Reactivar suscripción"}
          </Button>
          {revertState.error && <p className="text-xs text-destructive">{revertState.error}</p>}
        </form>
      )}

      {canManage && state.kind !== "canceling" && (
        <div className="mt-4">
          <Dialog>
            <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
              Cancelar suscripción
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>¿Cancelar la suscripción?</DialogTitle>
                <DialogDescription>
                  {state.kind === "renewing"
                    ? `Conservas el plan ${planLabel} hasta el ${state.periodEnd} y no se te vuelve a cobrar. Ese día tu clínica pasa a Free.`
                    : "Tu clínica pasa a Free de inmediato."}
                </DialogDescription>
              </DialogHeader>
              <ul className="list-disc space-y-1.5 pl-4 text-sm text-foreground/90">
                <li>
                  Free incluye {freeLimits}. Si superas esos límites, no podrás agregar más hasta
                  volver a un plan pago.
                </li>
                <li>No se borra nada: tus pacientes, historias clínicas y reportes siguen disponibles.</li>
                {state.kind === "renewing" && <li>Puedes reactivarla antes del {state.periodEnd}.</li>}
              </ul>
              {cancelState.error && (
                <p className="flex items-start gap-1.5 text-xs text-destructive">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {cancelState.error}
                </p>
              )}
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" />}>Volver</DialogClose>
                <form action={cancelAction}>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={cancelPending}
                    className="w-full"
                  >
                    {cancelPending ? "Cancelando…" : "Sí, cancelar"}
                  </Button>
                </form>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </section>
  );
}
