import Link from "next/link";
import { Users, CreditCard, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getClinicOverview } from "@/lib/db/clinic";
import { getTranscriptionUsage } from "@/lib/db/transcription-usage";
import { PLANS, transcriptionUsageLabel } from "@/lib/plans";
import { UsageBar } from "@/components/usage-bar";

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
        <div className="mt-4 space-y-3">
          <UsageBar used={overview.patientCount} max={limits.maxPatients} label="Pacientes" />
          <UsageBar used={overview.doctorCount} max={limits.maxDoctors} label="Profesionales" />
          <UsageBar
            used={usage.usedSeconds / 3600}
            max={limits.transcriptionHours}
            label="Transcripción este mes"
            display={transcriptionUsageLabel(usage.usedSeconds, overview.plan)}
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
