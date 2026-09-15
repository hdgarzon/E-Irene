import Link from "next/link";
import { Users, CreditCard, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getClinicOverview, type ClinicOverview } from "@/lib/db/clinic";
import { getTranscriptionUsage } from "@/lib/db/transcription-usage";
import { PLANS, transcriptionLimitHours, transcriptionUsageLabel } from "@/lib/plans";
import { formatLongDate } from "@/lib/dates";
import { subscriptionState } from "@/lib/billing/subscription-state";
import { UsageBar } from "@/components/usage-bar";

/** Qué pasa con el plan y cuándo, en una línea. */
function planStatusLine(overview: ClinicOverview): string {
  const state = subscriptionState(overview.plan, overview.subscription);
  if (state.kind === "renewing") {
    return state.scheduledPlan
      ? `Se renueva el ${formatLongDate(state.periodEnd)} con el plan ${PLANS[state.scheduledPlan].label}.`
      : `Se renueva el ${formatLongDate(state.periodEnd)}.`;
  }
  if (state.kind === "canceling") {
    return `Suscripción cancelada: pasas a Free el ${formatLongDate(state.periodEnd)}.`;
  }
  if (state.kind === "overdue") {
    return `No se pudo cobrar la renovación: si no se paga, pasas a Free el ${formatLongDate(state.graceEndsAt)}.`;
  }
  return `Las cuotas del plan se reinician el ${formatLongDate(overview.cycleEnd)}.`;
}

export default async function SettingsPage() {
  const user = await requireRole(["admin", "doctor"]);
  const isAdmin = user.role === "admin";
  const [overview, usage] = await Promise.all([getClinicOverview(), getTranscriptionUsage()]);
  const limits = PLANS[overview.plan];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Configuración</h1>
        <p className="text-sm text-muted-foreground">{user.clinicName}</p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-navy">Plan actual</h2>
          <span className="rounded-full bg-brand/15 px-3 py-1 text-sm font-medium text-brand">
            {limits.label} · {limits.price}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{planStatusLine(overview)}</p>
        <div className="mt-4 space-y-3">
          <UsageBar used={overview.patientCount} max={limits.maxPatients} label="Pacientes" />
          <UsageBar used={overview.doctorCount} max={limits.maxDoctors} label="Profesionales" />
          <UsageBar
            used={overview.consultationsThisCycle}
            max={limits.consultationsPerMonth}
            label="Consultas del ciclo"
          />
          <UsageBar
            used={usage.usedSeconds / 3600}
            max={transcriptionLimitHours(overview.plan, usage.extraSeconds)}
            label="Transcripción del ciclo"
            display={transcriptionUsageLabel(usage.usedSeconds, overview.plan, usage.extraSeconds)}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {isAdmin && (
          <Link
            href="/settings/team"
            className="flex items-center justify-between rounded-2xl border border-gray-line bg-card p-5 transition-shadow hover:shadow-md"
          >
            <span className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-cloud">
                <Users className="size-5 text-brand" />
              </span>
              <span>
                <span className="block font-medium text-navy">Equipo</span>
                <span className="text-xs text-muted-foreground">
                  {overview.memberCount} miembro{overview.memberCount === 1 ? "" : "s"}
                </span>
              </span>
            </span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        )}

        <Link
          href="/settings/plan"
          className="flex items-center justify-between rounded-2xl border border-gray-line bg-card p-5 transition-shadow hover:shadow-md"
        >
          <span className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-cloud">
              <CreditCard className="size-5 text-brand" />
            </span>
            <span>
              <span className="block font-medium text-navy">Plan y facturación</span>
              <span className="text-xs text-muted-foreground">Cambiar de plan</span>
            </span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}
