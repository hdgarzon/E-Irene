import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listTodayAppointments } from "@/lib/db/appointments";
import { countPendingReports, listRiskAlerts, type RiskAlert } from "@/lib/db/reports";
import { countPatientsWithoutConsent } from "@/lib/db/consents";
import { formatTime, formatFullDate } from "@/lib/dates";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const APPT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  completed: "Completada",
  no_show: "No asistió",
};

const RISK_LABEL: Record<RiskAlert["categories"][number]["key"], string> = {
  suicidal_ideation: "Ideación suicida",
  self_harm: "Autolesión",
  substance_use: "Consumo de sustancias",
  risk_to_others: "Riesgo a terceros",
};

async function patientCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("patients").select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  const isClinician = user?.role === "admin" || user?.role === "doctor";

  // Solo el personal clínico ve contenido de reportes/riesgo (la secretaría no).
  const [patients, todayAppts, pendingReports, patientsNoConsent, riskAlerts] = await Promise.all([
    patientCount(),
    listTodayAppointments(),
    isClinician ? countPendingReports() : Promise.resolve(0),
    countPatientsWithoutConsent(),
    isClinician ? listRiskAlerts() : Promise.resolve<RiskAlert[]>([]),
  ]);

  const firstName = user?.fullName.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Hola, {firstName} 👋</h1>
        <p className="text-sm text-muted-foreground capitalize">
          {formatFullDate(new Date().toISOString())}
        </p>
      </div>

      {/* Alertas de riesgo — lo más importante arriba */}
      {isClinician && riskAlerts.length > 0 && (
        <section className="rounded-2xl border border-coral/40 bg-coral/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            <h2 className="font-heading font-semibold text-navy">
              Alertas de riesgo ({riskAlerts.length})
            </h2>
          </div>
          <ul className="space-y-2">
            {riskAlerts.slice(0, 5).map((a) => (
              <li key={a.consultationId}>
                <Link
                  href={`/consultations/${a.consultationId}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-line bg-card p-3 transition-shadow hover:shadow-sm"
                >
                  <span className="font-medium text-navy">{a.patientName}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {a.categories.map((c) => (
                      <Badge
                        key={c.key}
                        variant="secondary"
                        className={cn(
                          "text-[11px]",
                          c.level === "alto"
                            ? "bg-coral/15 text-destructive"
                            : "bg-amber-100 text-amber-800",
                        )}
                      >
                        {RISK_LABEL[c.key]} · {c.level}
                      </Badge>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            Detección temprana por IA — apoyo a tu criterio, nunca un diagnóstico.
          </p>
        </section>
      )}

      {/* Pendientes */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatLink
          href="/patients"
          icon={Users}
          label="Pacientes"
          value={patients}
          accent="text-purple"
        />
        <StatLink
          href="/appointments"
          icon={CalendarDays}
          label="Citas hoy"
          value={todayAppts.length}
          accent="text-purple"
        />
        <StatLink
          href="/patients"
          icon={FileWarning}
          label="Sin consentimiento"
          value={patientsNoConsent}
          accent={patientsNoConsent > 0 ? "text-destructive" : "text-mint"}
          muted={patientsNoConsent === 0}
        />
        {isClinician && (
          <StatLink
            href="/reports"
            icon={ClipboardCheck}
            label="Reportes por validar"
            value={pendingReports}
            accent={pendingReports > 0 ? "text-destructive" : "text-mint"}
            muted={pendingReports === 0}
          />
        )}
      </div>

      {/* Agenda de hoy */}
      <section className="rounded-2xl border border-gray-line bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading font-semibold text-navy">Agenda de hoy</h2>
          <Link href="/appointments" className="text-sm text-purple hover:underline">
            Ver toda la agenda
          </Link>
        </div>
        {todayAppts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CalendarDays className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No tienes citas para hoy.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-line">
            {todayAppts.map((a) => (
              <li key={a.id} className="flex items-center gap-4 py-3">
                <span className="w-14 shrink-0 font-heading font-semibold tabular-nums text-navy">
                  {formatTime(a.scheduledAt)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy">{a.patientName}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.doctorName}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[11px]">
                  {APPT_STATUS_LABEL[a.status] ?? a.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Acciones rápidas */}
      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <h2 className="font-heading font-semibold text-navy">Acciones rápidas</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/patients/new" className={cn(buttonVariants())}>
            <Plus className="size-4" />
            Nuevo paciente
          </Link>
          <Link href="/appointments/new" className={cn(buttonVariants({ variant: "outline" }))}>
            <CalendarDays className="size-4" />
            Agendar cita
          </Link>
        </div>
      </div>

      {/* Nota de seguridad, discreta al fondo */}
      <div className="flex items-start gap-3 rounded-2xl border border-mint/30 bg-soft-mint/20 p-4">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-mint" />
        <p className="text-xs text-muted-foreground">
          {user?.clinicName} · Datos cifrados (AES-256), aislados por clínica. El audio de las
          sesiones nunca se guarda en el servidor.
        </p>
      </div>
    </div>
  );
}

function StatLink({
  href,
  icon: Icon,
  label,
  value,
  accent,
  muted = false,
}: {
  href: string;
  icon: typeof Users;
  label: string;
  value: number;
  accent: string;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-gray-line bg-card p-5 transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-cloud">
          {muted ? (
            <Icon className="size-5 text-mint" />
          ) : value > 0 && accent.includes("destructive") ? (
            <AlertTriangle className={cn("size-5", accent)} />
          ) : (
            <Icon className={cn("size-5", accent)} />
          )}
        </span>
        <span className="font-heading text-3xl font-bold text-navy tabular-nums">{value}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-muted-foreground">{label}</p>
    </Link>
  );
}
