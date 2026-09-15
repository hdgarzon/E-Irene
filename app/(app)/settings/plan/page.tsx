import Link from "next/link";
import { ArrowLeft, Check, Info, CheckCircle2, Clock } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getClinicOverview } from "@/lib/db/clinic";
import { subscriptionState, type SubscriptionState } from "@/lib/billing/subscription-state";
import { planChangeOption } from "@/lib/billing/plan-change";
import { getTranscriptionUsage } from "@/lib/db/transcription-usage";
import {
  PLANS,
  PLAN_ORDER,
  formatCop,
  limitLabel,
  transcriptionLimitSeconds,
  transcriptionUsageLabel,
  type Plan,
} from "@/lib/plans";
import { formatLongDate } from "@/lib/dates";
import {
  initiatePlanUpgradeAction,
  schedulePlanDowngradeAction,
} from "@/app/(app)/settings/actions";
import { reconcilePlanPayment, type ReconcileOutcome } from "@/lib/billing/reconcile";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { UsageBar } from "@/components/usage-bar";
import { SubscriptionPanel, type SubscriptionPanelState } from "@/components/subscription-panel";

interface PlanPageProps {
  searchParams: Promise<{ wompi?: string; id?: string; cambio?: string }>;
}

/** Enterprise se acuerda por correo, con el mismo contacto de la página pública. */
const ENTERPRISE_CONTACT_URL = "mailto:hola@e-irene.co?subject=Plan%20Enterprise";

/** Resultado de un cambio de plan, tras volver de la acción (?cambio=). */
const PLAN_CHANGE_NOTICES: Record<string, { tone: "ok" | "warn" | "error"; text: string }> = {
  programado: {
    tone: "ok",
    text: "Cambio de plan programado. Rige desde la próxima renovación; hasta entonces conservas tu plan actual.",
  },
  cancelacion_pendiente: {
    tone: "warn",
    text: "Tienes una cancelación pedida. Reactiva la suscripción para programar un cambio de plan.",
  },
  no_programado: {
    tone: "error",
    text: "No se pudo programar el cambio de plan. Intenta de nuevo o escríbenos.",
  },
  renovacion_en_curso: {
    tone: "warn",
    text: "Hay un cobro de renovación en proceso. Cuando se confirme podrás cambiar de plan.",
  },
  no_cotizable: {
    tone: "error",
    text: "No pudimos calcular la diferencia para cambiar de plan. Escríbenos y lo resolvemos.",
  },
};

const NOTICE_TONE = {
  ok: "border-mint/40 bg-soft-mint/20 text-foreground/90",
  warn: "border-amber-400/40 bg-amber-400/10 text-foreground/90",
  error: "border-coral/40 bg-coral/5 text-destructive",
};

/**
 * Qué incluye Free, en una frase: lo que ve quien está por cancelar.
 *
 * No menciona el análisis con IA a propósito: PLANS.free.ai es false, pero nada
 * lo aplica —las clínicas Free también reciben análisis y alertas de riesgo— y
 * decirle a quien cancela que lo pierde sería falso.
 */
function freeLimitsSummary(): string {
  const f = PLANS.free;
  return (
    `${limitLabel(f.maxDoctors)} profesional${f.maxDoctors === 1 ? "" : "es"}, ` +
    `${limitLabel(f.maxPatients)} pacientes, ${limitLabel(f.consultationsPerMonth)} consultas y ` +
    `${limitLabel(f.transcriptionHours)} h de transcripción por ciclo`
  );
}

/** Estado de la suscripción con las fechas ya en texto, para el panel (cliente). */
function toPanelState(state: SubscriptionState): SubscriptionPanelState | null {
  // Free y los planes a convenir no tienen una suscripción que administrar aquí.
  if (state.kind === "free" || state.kind === "negotiated") return null;
  if (state.kind === "unbilled") return { kind: "unbilled" };
  if (state.kind === "overdue") {
    return {
      kind: "overdue",
      periodEnd: formatLongDate(state.periodEnd),
      graceEndsOn: formatLongDate(state.graceEndsAt),
      periodEnded: state.periodEnded,
    };
  }
  if (state.kind === "renewing") {
    return {
      kind: "renewing",
      periodEnd: formatLongDate(state.periodEnd),
      scheduledChange: state.scheduledPlan
        ? { planLabel: PLANS[state.scheduledPlan].label, price: PLANS[state.scheduledPlan].price }
        : null,
    };
  }
  return { kind: "canceling", periodEnd: formatLongDate(state.periodEnd) };
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const user = await requireRole(["admin", "doctor"]);
  const { wompi, id: transactionId, cambio } = await searchParams;

  // Wompi devuelve al usuario con ?id=<transaction_id>. Se verifica el pago
  // contra la API de Wompi y se aplica si corresponde — red de seguridad para
  // que un webhook no entregado no deje a la clínica pagando sin recibir lo
  // comprado (ver lib/billing/reconcile.ts). Es idempotente: si el webhook ya
  // lo procesó, esto no hace nada.
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
  const limits = PLANS[overview.plan];
  const limitSeconds = transcriptionLimitSeconds(overview.plan);
  const quotaExhausted = limitSeconds !== null && usage.usedSeconds >= limitSeconds;
  const isAdmin = user.role === "admin";
  const cycleEndLabel = formatLongDate(overview.cycleEnd);
  const state = subscriptionState(overview.plan, overview.subscription);
  const panelState = toPanelState(state);
  const notice = cambio ? PLAN_CHANGE_NOTICES[cambio] : undefined;


  function features(plan: Plan) {
    const l = PLANS[plan];
    const extras = [
      l.ai ? "Análisis con IA" : "Sin análisis con IA",
      l.whatsapp ? "Recordatorios por WhatsApp" : "Recordatorios por correo",
    ];
    // Un plan a convenir no tiene topes en la app: los fija su contrato.
    if (l.priceInCents === null) {
      return [
        "Profesionales y pacientes ilimitados",
        "Consultas y transcripción según contrato",
        ...extras,
      ];
    }
    return [
      `${limitLabel(l.maxDoctors)} profesional${l.maxDoctors === 1 ? "" : "es"}`,
      `${limitLabel(l.maxPatients)} pacientes`,
      `${limitLabel(l.consultationsPerMonth)} consultas por ciclo`,
      `${limitLabel(l.transcriptionHours)} h de transcripción`,
      ...extras,
    ];
  }

  /** Botón de un plan pago que no es el actual (regla en lib/billing/plan-change.ts). */
  function paidPlanAction(plan: Plan) {
    const l = PLANS[plan];
    const option = planChangeOption({
      current: overview.plan,
      target: plan,
      state,
      anchor: overview.billingCycleAnchor,
      isAdmin,
    });
    const note = (text: string) => (
      <p className="text-center text-xs text-muted-foreground">{text}</p>
    );

    switch (option.kind) {
      case "upgrade":
        return (
          <form action={initiatePlanUpgradeAction.bind(null, plan)} className="space-y-1.5">
            <Button type="submit" size="sm" className="w-full">
              Pagar {formatCop(option.quote.amountInCents)} y cambiar
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Diferencia por lo que queda del ciclo. Desde el{" "}
              {formatLongDate(option.quote.periodEnd)}, {l.price}.
              {option.replacesScheduledPlan &&
                ` Anula el cambio programado al plan ${PLANS[option.replacesScheduledPlan].label}.`}
            </p>
          </form>
        );
      case "downgrade":
        if (option.scheduled) {
          return (
            <p className="text-center text-xs font-medium text-navy">
              Cambio programado para el {formatLongDate(option.effectiveAt)}
            </p>
          );
        }
        return (
          <form action={schedulePlanDowngradeAction.bind(null, plan)} className="space-y-1.5">
            <Button type="submit" variant="outline" size="sm" className="w-full">
              Programar cambio a {l.label}
            </Button>
            {note(`Sin cobro hoy. Rige desde el ${formatLongDate(option.effectiveAt)}.`)}
          </form>
        );
      case "blocked":
        return note(
          option.reason === "canceling"
            ? "Reactiva la suscripción para cambiar de plan"
            : option.reason === "admin_only"
              ? "Solo el administrador de la clínica puede cambiar de plan"
              : "Escríbenos para cambiar a este plan",
        );
      case "purchase":
        return (
          <form action={initiatePlanUpgradeAction.bind(null, plan)}>
            <Button type="submit" size="sm" className="w-full">
              Pagar y cambiar a {l.label}
            </Button>
          </form>
        );
      default:
        return null;
    }
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
          Elige el plan que mejor se ajuste a tu práctica. Precios mensuales en pesos colombianos.
        </p>
      </div>

      {(reconciled?.result === "activated" || reconciled?.result === "already_processed") && (
        <div className="rounded-2xl border border-mint/40 bg-soft-mint/20 p-4 text-sm text-foreground/90">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-mint" />
            <p>
              <span className="font-semibold text-navy">Pago confirmado.</span>{" "}
              {reconciled.kind === "upgrade"
                ? `Ya tienes el plan ${PLANS[reconciled.plan].label}; tu fecha de renovación no cambia.`
                : "Tu plan ya está activo."}
            </p>
          </div>
        </div>
      )}

      {reconciled?.result === "rejected" && (
        <div className="rounded-2xl border border-coral/40 bg-coral/5 p-4 text-sm text-destructive">
          <p>
            Recibimos tu pago, pero no se pudo aplicar automáticamente (por ejemplo, porque el plan
            o el período cambiaron mientras pagabas). Escríbenos y lo resolvemos: el pago queda
            registrado y no necesitas volver a pagar.
          </p>
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

      {notice && (
        <div
          role="status"
          className={cn("rounded-2xl border p-4 text-sm", NOTICE_TONE[notice.tone])}
        >
          <p>{notice.text}</p>
        </div>
      )}

      {panelState && (
        <SubscriptionPanel
          planLabel={limits.label}
          state={panelState}
          freeLimits={freeLimitsSummary()}
          canManage={isAdmin}
          payAction={initiatePlanUpgradeAction.bind(null, overview.plan)}
        />
      )}

      <div className="rounded-2xl border border-gray-line bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading font-semibold text-navy">Consumo del ciclo</h2>
          <span className="text-xs text-muted-foreground">Se reinicia el {cycleEndLabel}</span>
        </div>
        <div className="mt-3 space-y-3">
          <UsageBar
            used={overview.consultationsThisCycle}
            max={limits.consultationsPerMonth}
            label="Consultas"
          />
          <UsageBar
            used={usage.usedSeconds / 3600}
            max={limits.transcriptionHours}
            label="Horas de transcripción"
            display={transcriptionUsageLabel(usage.usedSeconds, overview.plan)}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {usage.sessions} consulta{usage.sessions === 1 ? "" : "s"} con transcripción en este
          ciclo. Lo que no se usa no se acumula para el siguiente.
        </p>
        {quotaExhausted && (
          <p className="mt-2 text-xs text-destructive">
            Cuota agotada: las nuevas consultas no se transcribirán hasta el {cycleEndLabel} o hasta
            ampliar el plan.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PLAN_ORDER.map((plan) => {
          const l = PLANS[plan];
          const current = overview.plan === plan;
          const negotiated = l.priceInCents === null;
          const paid = l.priceInCents !== null && l.priceInCents > 0;
          return (
            <div
              key={plan}
              data-plan={plan}
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
                ) : negotiated ? (
                  // No se vende por la app: el precio y los límites se acuerdan por contrato.
                  <a
                    href={ENTERPRISE_CONTACT_URL}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
                  >
                    Contáctanos
                  </a>
                ) : !paid ? (
                  // Free no se "compra": se llega cancelando la suscripción, que
                  // conserva lo pagado hasta el fin del período.
                  <p className="text-center text-xs text-muted-foreground">
                    {state.kind === "canceling" ? (
                      <>Pasas a Free el {formatLongDate(state.periodEnd)}</>
                    ) : state.kind === "overdue" ? (
                      <>
                        Pasas a Free el {formatLongDate(state.graceEndsAt)} si no se paga la
                        renovación
                      </>
                    ) : state.kind === "negotiated" ? (
                      "Tu plan tiene condiciones acordadas: escríbenos para cambiarlo"
                    ) : isAdmin ? (
                      <a href="#suscripcion" className="font-medium text-brand hover:underline">
                        Cancela la suscripción para pasar a Free
                      </a>
                    ) : (
                      "Para pasar a Free, el administrador debe cancelar la suscripción"
                    )}
                  </p>
                ) : (
                  paidPlanAction(plan)
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Los pagos se procesan de forma segura a través de Wompi. Tu tarjeta o medio de pago se
        tokeniza para la suscripción mensual. Si subes de plan pagas solo la diferencia por lo que
        queda del ciclo y tu fecha de renovación no cambia; si bajas, el cambio rige desde la
        renovación. Puedes cancelar en cualquier momento y conservas el plan hasta el final del
        período pagado.
      </p>
    </div>
  );
}
