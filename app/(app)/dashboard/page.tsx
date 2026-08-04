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
import { countPendingReports } from "@/lib/db/reports";
import { listOpenRiskAlerts, type RiskAlert } from "@/lib/db/risk-alerts";
import { listPhq9RiskAlerts, type Phq9RiskAlert } from "@/lib/db/assessments";
import { countPatientsWithoutConsent } from "@/lib/db/consents";
import { RISK_CATEGORY_LABEL } from "@/lib/risk-flags";
import { formatTime, formatFullDate } from "@/lib/dates";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { acknowledgeRiskAlertAction } from "./actions";

const APPT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  completed: "Completada",
  no_show: "No asistió",
};

async function patientCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("patients").select("*", { count: "exact", head: true });
  return count ?? 0;
}

function SessionRiskAlertItem({ alert, href }: { alert: RiskAlert; href: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-line bg-card p-3 transition-shadow hover:shadow-sm">
      <Link href={href} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="font-medium text-navy">{alert.patientName}</span>
        <span className="flex flex-wrap gap-1.5">
          {alert.categories.map((c) => (
            <Badge
              key={c.key}
              variant="secondary"
              className={cn(
                "text-[11px]",
                c.level === "alto" ? "bg-coral/15 text-destructive" : "bg-amber-100 text-amber-800",
              )}
            >
              {RISK_CATEGORY_LABEL[c.key]} · {c.level}
            </Badge>
          ))}
        </span>
      </Link>
      <form action={acknowledgeRiskAlertAction.bind(null, alert.id)}>
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-gray-line px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-mint hover:text-mint"
        >
          Acusar recibo
        </button>
      </form>
    </li>
  );
}

function Phq9RiskAlertItem({ alert }: { alert: Phq9RiskAlert }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-line bg-card p-3 transition-shadow hover:shadow-sm">
      <Link href={`/patients/${alert.patientId}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="font-medium text-navy">{alert.patientName}</span>
        <Badge variant="secondary" className="bg-coral/15 text-[11px] text-destructive">
          Autolesión · PHQ-9
        </Badge>
      </Link>
    </li>
  );
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  const isClinician = user?.role === "admin" || user?.role === "doctor";

  // Solo el personal clínico ve contenido de reportes/riesgo (la secretaría no).
  const [patients, todayAppts, pendingReports, patientsNoConsent, sessionAlerts, phq9Alerts] =
    await Promise.all([
      patientCount(),
      listTodayAppointments(),
      isClinician ? countPendingReports() : Promise.resolve(0),
      countPatientsWithoutConsent(),
      isClinician ? listOpenRiskAlerts() : Promise.resolve<RiskAlert[]>([]),
      isClinician ? listPhq9RiskAlerts() : Promise.resolve<Phq9RiskAlert[]>([]),
    ]);

  const allRiskAlerts = [...sessionAlerts, ...phq9Alerts];

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
      {isClinician && allRiskAlerts.length > 0 && (
        <section className="rounded-2xl border border-coral/40 bg-coral/5 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            <h2 className="font-heading font-semibold text-navy">
              Alertas de riesgo ({allRiskAlerts.length})
            </h2>
          </div>
          {sessionAlerts.length > 0 && (
            <>
              <h3
                id="risk-alerts-ia-heading"
                className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                De consultas (IA)
              </h3>
              <ul className="space-y-2" aria-labelledby="risk-alerts-ia-heading">
                {sessionAlerts.slice(0, 5).map((a) => (
                  <SessionRiskAlertItem
                    key={a.id}
                    alert={a}
                    href={`/consultations/${a.consultationId}`}
                  />
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Detección temprana por IA — apoyo a tu criterio, nunca un diagnóstico.
              </p>
            </>
          )}
          {phq9Alerts.length > 0 && (
            <>
              <h3
                id="risk-alerts-phq9-heading"
                className={cn(
                  "mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                  sessionAlerts.length > 0 && "mt-4",
                )}
              >
                De cuestionarios (PHQ-9)
              </h3>
              <ul className="space-y-2" aria-labelledby="risk-alerts-phq9-heading">
                {phq9Alerts.slice(0, 5).map((a) => (
                  <Phq9RiskAlertItem key={a.assessmentId} alert={a} />
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                Autolesión reportada directamente por el paciente en el PHQ-9 — no es una
                detección por IA.
              </p>
            </>
          )}
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
