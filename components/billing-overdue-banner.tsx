import Link from "next/link";
import { CreditCard } from "lucide-react";
import type { ClinicSubscription } from "@/lib/db/clinic";
import { PLANS, type Plan } from "@/lib/plans";
import { formatLongDate } from "@/lib/dates";
import { subscriptionState } from "@/lib/billing/subscription-state";

/**
 * Aviso de renovación sin cobrar. Va arriba del dashboard porque es donde la
 * clínica entra a diario: sin él, la primera noticia de la gracia sería el paso
 * a Free.
 */
export function BillingOverdueBanner({
  plan,
  subscription,
}: {
  plan: Plan;
  subscription: ClinicSubscription;
}) {
  const state = subscriptionState(plan, subscription);
  if (state.kind !== "overdue") return null;

  return (
    <Link
      href="/settings/plan#suscripcion"
      className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
    >
      <CreditCard className="mt-0.5 size-5 shrink-0 text-amber-700" />
      <div className="space-y-0.5">
        <p className="font-medium text-amber-900">
          No se pudo cobrar la renovación del plan {PLANS[plan].label}
        </p>
        <p className="text-sm text-amber-900/80">
          Si el pago no se completa antes del {formatLongDate(state.graceEndsAt)}, tu clínica pasa a
          Free. No se borra ningún dato. Puedes pagar desde Plan y facturación.
        </p>
      </div>
    </Link>
  );
}
