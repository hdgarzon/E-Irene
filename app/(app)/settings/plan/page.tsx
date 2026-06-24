import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getClinicOverview } from "@/lib/db/clinic";
import { PLANS, PLAN_ORDER, limitLabel } from "@/lib/plans";
import { changePlanAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";

export default async function PlanPage() {
  await requireRole(["admin"]);
  const overview = await getClinicOverview();

  function features(plan: (typeof PLAN_ORDER)[number]) {
    const l = PLANS[plan];
    return [
      `${limitLabel(l.maxDoctors)} profesional${l.maxDoctors === 1 ? "" : "es"}`,
      `${limitLabel(l.maxPatients)} pacientes`,
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLAN_ORDER.map((plan) => {
          const l = PLANS[plan];
          const current = overview.plan === plan;
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
                  <form action={changePlanAction.bind(null, plan)}>
                    <Button type="submit" size="sm" className="w-full">
                      Cambiar a {l.label}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Modo demo: el cambio de plan es inmediato y sin cobro. Integra Stripe para facturación real.
      </p>
    </div>
  );
}
