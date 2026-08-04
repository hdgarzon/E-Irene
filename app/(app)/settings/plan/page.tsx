import Link from "next/link";
import { ArrowLeft, Check, Info } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getClinicOverview } from "@/lib/db/clinic";
import { PLANS, PLAN_ORDER, limitLabel } from "@/lib/plans";
import { initiatePlanUpgradeAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

interface PlanPageProps {
  searchParams: Promise<{ wompi?: string }>;
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  await requireRole(["admin"]);
  const overview = await getClinicOverview();
  const { wompi } = await searchParams;

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

      {wompi === "return" && (
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLAN_ORDER.map((plan) => {
          const l = PLANS[plan];
          const current = overview.plan === plan;
          const paid = l.priceInCents > 0;
          return (
            <div
              key={plan}
              className={`flex flex-col rounded-2xl border bg-card p-5 ${
                current ? "border-purple ring-1 ring-purple" : "border-gray-line"
              }`}
            >
              <h3 className="font-heading text-lg font-bold text-navy">{l.label}</h3>
              <p className="mb-3 text-2xl font-bold text-purple">{l.price}</p>
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
