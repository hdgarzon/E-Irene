import Link from "next/link";
import { Users, CreditCard, ChevronRight } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getClinicOverview } from "@/lib/db/clinic";
import { PLANS, limitLabel } from "@/lib/plans";

function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = Number.isFinite(max) ? Math.min((used / max) * 100, 100) : Math.min(used, 100) / 4;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-navy">
          {used} / {limitLabel(max)}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-destructive" : "bg-purple"}`}
          style={{ width: `${Number.isFinite(max) ? pct : 25}%` }}
        />
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireRole(["admin"]);
  const overview = await getClinicOverview();
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
          <span className="rounded-full bg-purple/15 px-3 py-1 text-sm font-medium text-purple">
            {limits.label} · {limits.price}
          </span>
        </div>
        <div className="mt-4 space-y-3">
          <UsageBar used={overview.patientCount} max={limits.maxPatients} label="Pacientes" />
          <UsageBar used={overview.doctorCount} max={limits.maxDoctors} label="Profesionales" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/settings/team"
          className="flex items-center justify-between rounded-2xl border border-gray-line bg-card p-5 transition-shadow hover:shadow-md"
        >
          <span className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-cloud">
              <Users className="size-5 text-purple" />
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

        <Link
          href="/settings/plan"
          className="flex items-center justify-between rounded-2xl border border-gray-line bg-card p-5 transition-shadow hover:shadow-md"
        >
          <span className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-cloud">
              <CreditCard className="size-5 text-purple" />
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
