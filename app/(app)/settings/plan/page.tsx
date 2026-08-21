import Link from "next/link";
import { ArrowLeft, Check, Info, CheckCircle2, Clock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getClinicOverview } from "@/lib/db/clinic";
import { getTranscriptionUsage } from "@/lib/db/transcription-usage";
import {
  PLANS,
  PLAN_ORDER,
  limitLabel,
  transcriptionLimitSeconds,
  transcriptionUsageLabel,
} from "@/lib/plans";
import { initiatePlanUpgradeAction } from "@/app/(app)/settings/actions";
import { reconcilePlanPayment, type ReconcileOutcome } from "@/lib/billing/reconcile";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { UsageBar } from "@/components/usage-bar";

interface PlanPageProps {
  searchParams: Promise<{ wompi?: string; id?: string }>;
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const user = await requireRole(["admin", "doctor"]);
  const { wompi, id: transactionId } = await searchParams;

  // Wompi devuelve al usuario con ?id=<transaction_id>. Se verifica el pago
  // contra la API de Wompi y se activa el plan si corresponde — red de
  // seguridad para que un webhook no entregado no deje a la clínica pagando
  // sin recibir el plan (ver lib/billing/reconcile.ts). Es idempotente: si el
  // webhook ya lo procesó, esto no hace nada.
  let reconciled: ReconcileOutcome | null = null;
  if (transactionId) {
    try {
      reconciled = await reconcilePlanPayment(transactionId, user.clinicId);
    } catch (error) {
      logger.error("billing.reconcile_on_return_failed", {
        clinicId: user.clinicId,
        transactionId,
        error,
      });
    }
  }

  // Después de reconciliar, para que el plan mostrado ya refleje la activación.
  // El consumo de transcripción no depende de la reconciliación: se pide en
  // paralelo.
  const [overview, usage] = await Promise.all([getClinicOverview(), getTranscriptionUsage()]);
  const limitSeconds = transcriptionLimitSeconds(overview.plan);
  const quotaExhausted = limitSeconds !== null && usage.usedSeconds >= limitSeconds;

  function features(plan: (typeof PLAN_ORDER)[number]) {
    const l = PLANS[plan];
    return [
      `${limitLabel(l.maxDoctors)} profesional${l.maxDoctors === 1 ? "" : "es"}`,
      `${limitLabel(l.maxPatients)} pacientes`,
      `${limitLabel(l.consultationsPerMonth)} consultas/mes`,
      `${limitLabel(l.transcriptionHours)} h de transcripción`,
      l.ai ? "Análisis con IA" : "Sin análisis con IA",
      l.whatsapp ? "Recordatorios por WhatsApp" : "Recordatorios por correo",
    ];
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Configuración
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Plan y facturación</h1>
        <p className="text-sm text-muted-foreground">
          Elige el plan que mejor se ajuste a tu práctica.
        </p>
      </div>

      {(reconciled?.result === "activated" || reconciled?.result === "already_processed") && (
        <div className="rounded-2xl border border-mint/40 bg-soft-mint/20 p-4 text-sm text-foreground/90">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-mint" />
            <p>
              <span className="font-semibold text-navy">Pago confirmado.</span> Tu plan ya está
              activo.
            </p>
          </div>
        </div>
      )}

      {reconciled?.result === "not_approved" && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-foreground/90">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <p>
              Tu pago está en proceso (estado: {reconciled.status}). Algunos medios, como PSE o
              Nequi, pueden tardar unos minutos. Tu plan se activará automáticamente al
              confirmarse.
            </p>
          </div>
        </div>
      )}

      {reconciled?.result === "ignored" && (
        <div className="rounded-2xl border border-coral/40 bg-coral/5 p-4 text-sm text-destructive">
          <p>
            No pudimos confirmar este pago automáticamente. Si el cobro se realizó, escribinos y lo
            resolvemos — el pago queda registrado.
          </p>
        </div>
      )}

      {wompi === "return" && !reconciled && (
        <div className="rounded-2xl border border-mint/40 bg-soft-mint/20 p-4 text-sm text-foreground/90">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-mint" />
            <p>
              Si el pago fue aprobado, tu plan se actualizará en unos segundos. Revisá tu correo
              para confirmar.
            </p>
          </div>
        </div>
      )}

      {wompi === "error" && (
        <div className="rounded-2xl border border-coral/40 bg-coral/5 p-4 text-sm text-destructive">
          <p>No se pudo iniciar el pago. Intentá de nuevo o contactá soporte.</p>
        </div>
      )}

      <div className="rounded-2xl border border-gray-line bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-navy">Consumo del mes</h2>
          <span className="text-xs text-muted-foreground">
            {usage.sessions} consulta{usage.sessions === 1 ? "" : "s"} con transcripción
          </span>
        </div>
        <div className="mt-3">
          <UsageBar
            used={usage.usedSeconds / 3600}
            max={PLANS[overview.plan].transcriptionHours}
            label="Horas de transcripción"
            display={transcriptionUsageLabel(usage.usedSeconds, overview.plan)}
          />
        </div>
        {quotaExhausted && (
          <p className="mt-3 text-xs text-destructive">
            Cuota agotada: las nuevas consultas no se transcribirán hasta el próximo mes o hasta
            ampliar el plan.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLAN_ORDER.map((plan) => {
          const l = PLANS[plan];
          const current = overview.plan === plan;
          const paid = l.priceInCents > 0;
          return (
            <div
              key={plan}
              className={`flex flex-col rounded-2xl border bg-card p-5 ${
                current ? "border-brand ring-1 ring-brand" : "border-gray-line"
              }`}
            >
              <h3 className="font-heading text-lg font-bold text-navy">{l.label}</h3>
              <p className="mb-3 text-2xl font-bold text-brand">{l.price}</p>
              <ul className="flex-1 space-y-1.5 text-xs text-muted-foreground">
                {features(plan).map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <Check className="mt-0.5 size-3 shrink-0 text-mint" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                {current ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Plan actual
                  </Button>
                ) : (
                  <form action={initiatePlanUpgradeAction.bind(null, plan)}>
                    <Button type="submit" size="sm" className="w-full">
                      {paid ? `Pagar y cambiar a ${l.label}` : `Cambiar a ${l.label}`}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Los pagos se procesan de forma segura a través de Wompi. Tu tarjeta o medio de pago se
        tokeniza para la suscripción mensual.
      </p>
    </div>
  );
}
