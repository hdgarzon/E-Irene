"use client";

import { useActionState } from "react";
import { CalendarClock, CircleAlert, CreditCard, RotateCcw } from "lucide-react";
import {
  cancelScheduledPlanChangeAction,
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
  /**
   * Período pagado vigente que se va a renovar. `scheduledChange` es el plan menor
   * que rige desde la renovación, si se programó un downgrade.
   */
  | {
      kind: "renewing";
      periodEnd: string;
      scheduledChange: { planLabel: string; price: string } | null;
    }
  /** Cancelación pedida: conserva el plan hasta periodEnd. */
  | { kind: "canceling"; periodEnd: string }
  /** Renovación sin cobrar: conserva el plan hasta graceEndsOn (lib/billing/subscription-state.ts). */
  | { kind: "overdue"; periodEnd: string; graceEndsOn: string; periodEnded: boolean }
  /** Plan asignado sin cobro: cancelar lo termina de inmediato. */
  | { kind: "unbilled" };

const initialState: SubscriptionState = {};

export function SubscriptionPanel({
  planLabel,
  state,
  freeLimits,
  canManage,
  payAction,
}: {
  planLabel: string;
  state: SubscriptionPanelState;
  /** Qué incluye Free, para que quien cancela sepa a qué pasa. */
  freeLimits: string;
  /** Solo el admin de la clínica cancela, reactiva o cambia el plan programado. */
  canManage: boolean;
  /** Checkout del plan actual: la salida de la gracia. */
  payAction: () => Promise<void>;
}) {
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelSubscriptionAction,
    initialState,
  );
  const [revertState, revertAction, revertPending] = useActionState(
    revertCancellationAction,
    initialState,
  );
  const [keepState, keepAction, keepPending] = useActionState(
    cancelScheduledPlanChangeAction,
    initialState,
  );

  // Cancelar conserva el plan hasta el fin del período solo si ese período
  // sigue vigente; si ya venció (o nunca hubo uno), termina de inmediato.
  const keepsUntil =
    state.kind === "renewing" || (state.kind === "overdue" && !state.periodEnded)
      ? state.periodEnd
      : null;
  const scheduledChange = state.kind === "renewing" ? state.scheduledChange : null;

  return (
    <section
      id="suscripcion"
      className={`rounded-2xl border bg-card p-5 ${
        state.kind === "overdue" ? "border-amber-300" : "border-gray-line"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cloud">
          {state.kind === "overdue" ? (
            <CreditCard className="size-4 text-amber-700" />
          ) : (
            <CalendarClock className="size-4 text-brand" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="font-heading font-semibold text-navy">Suscripción</h2>
          {state.kind === "renewing" && !scheduledChange && (
            <p className="text-sm text-foreground/90">
              Plan {planLabel} · se renueva el {state.periodEnd}. Puedes cancelar cuando quieras y
              conservas el plan hasta esa fecha.
            </p>
          )}
          {state.kind === "renewing" && scheduledChange && (
            <p className="text-sm text-foreground/90">
              Conservas el plan {planLabel} hasta el {state.periodEnd}. Ese día pasas al plan{" "}
              {scheduledChange.planLabel} y la renovación cobra {scheduledChange.price}. Si tienes
              más pacientes o profesionales de los que permite, se conservan, pero no podrás agregar
              más.
            </p>
          )}
          {state.kind === "canceling" && (
            <p className="text-sm text-foreground/90">
              Cancelaste la suscripción. Conservas el plan {planLabel} hasta el {state.periodEnd} y
              no se te vuelve a cobrar. Ese día tu clínica pasa a Free; no se borra ningún paciente,
              historia clínica ni reporte.
            </p>
          )}
          {state.kind === "overdue" && (
            <p className="text-sm text-foreground/90">
              {state.periodEnded
                ? `La renovación del plan ${planLabel} venció el ${state.periodEnd} y no se ha podido cobrar. Conservas el plan hasta el ${state.graceEndsOn}; si no se paga antes, tu clínica pasa a Free.`
                : `No se pudo cobrar la renovación del plan ${planLabel}. Lo pagado cubre hasta el ${state.periodEnd}; si el pago no se completa antes del ${state.graceEndsOn}, tu clínica pasa a Free.`}{" "}
              No se borra ningún dato.
            </p>
          )}
          {state.kind === "unbilled" && (
            <p className="text-sm text-foreground/90">
              El plan {planLabel} no tiene un cobro automático asociado.
            </p>
          )}
          {!canManage && (
            <p className="text-xs text-muted-foreground">
              Solo el administrador de la clínica puede cancelar, reactivar o programar cambios de
              la suscripción.
            </p>
          )}
        </div>
      </div>

      {state.kind === "overdue" && (
        <form action={payAction} className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm">
            <CreditCard className="size-3.5" />
            Pagar ahora
          </Button>
          <p className="text-xs text-muted-foreground">
            Al pagar, el plan se renueva por un mes desde ese día.
          </p>
        </form>
      )}

      {canManage && state.kind === "canceling" && (
        <form action={revertAction} className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={revertPending}>
            <RotateCcw className="size-3.5" />
            {revertPending ? "Reactivando…" : "Reactivar suscripción"}
          </Button>
          {revertState.error && <p className="text-xs text-destructive">{revertState.error}</p>}
        </form>
      )}

      {canManage && scheduledChange && (
        <form action={keepAction} className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" size="sm" disabled={keepPending}>
            <RotateCcw className="size-3.5" />
            {keepPending ? "Guardando…" : `Mantener plan ${planLabel}`}
          </Button>
          {keepState.error && <p className="text-xs text-destructive">{keepState.error}</p>}
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
                  {keepsUntil
                    ? `Conservas el plan ${planLabel} hasta el ${keepsUntil} y no se te vuelve a cobrar. Ese día tu clínica pasa a Free.`
                    : "Tu clínica pasa a Free de inmediato."}
                </DialogDescription>
              </DialogHeader>
              <ul className="list-disc space-y-1.5 pl-4 text-sm text-foreground/90">
                <li>
                  Free incluye {freeLimits}. Si superas esos límites, no podrás agregar más hasta
                  volver a un plan pago.
                </li>
                <li>No se borra nada: tus pacientes, historias clínicas y reportes siguen disponibles.</li>
                {scheduledChange && (
                  <li>Se anula el cambio programado al plan {scheduledChange.planLabel}.</li>
                )}
                {keepsUntil && <li>Puedes reactivarla antes del {keepsUntil}.</li>}
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
