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
import {
  listOpenRiskAlerts,
  reconcilePendingPhq9RiskAlerts,
  type Phq9ReconcileResult,
  type RiskAlert,
  type RiskAlertQueue,
} from "@/lib/db/risk-alerts";
import { countPatientsWithoutConsent } from "@/lib/db/consents";
import { getClinicSubscription } from "@/lib/db/clinic";
import { getMyVerification } from "@/lib/db/verification";
import { legacyVerificationState } from "@/lib/verification";
import { logger } from "@/lib/logger";
import { RISK_CATEGORY_LABEL } from "@/lib/risk-flags";
import { formatTime, formatFullDate } from "@/lib/dates";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VerificationBanner } from "@/components/verification-banner";
import { BillingOverdueBanner } from "@/components/billing-overdue-banner";
import { cn } from "@/lib/utils";
import { acknowledgeRiskAlertAction } from "./actions";

const APPT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  completed: "Completada",
  no_show: "No asistió",
};

/** Alertas por fuente en la vista normal del dashboard. */
const RISK_ALERT_PREVIEW = 5;
/**
 * Tope por fuente de la cola completa (`?alerts=all`). Si alguna vez se
 * supera, la página dice cuántas quedan sin mostrar.
 */
const RISK_ALERT_FULL_QUEUE = 200;
const EMPTY_QUEUE: RiskAlertQueue = { alerts: [], total: 0 };

async function patientCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase.from("patients").select("*", { count: "exact", head: true });
  return count ?? 0;
}

function AcknowledgeRiskAlertButton({ alertId }: { alertId: string }) {
  return (
    <form action={acknowledgeRiskAlertAction.bind(null, alertId)}>
      <button
        type="submit"
        className="shrink-0 rounded-lg border border-gray-line px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-mint hover:text-mint"
      >
        Acusar recibo
      </button>
    </form>
  );
}

function SessionRiskAlertItem({ alert, href }: { alert: RiskAlert; href: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-line bg-card p-3 transition-shadow hover:shadow-sm">
      <Link href={href} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="font-medium text-navy">{alert.patientName}</span>
        <span className="flex flex-wrap gap-1.5">
          {alert.categories ? (
            alert.categories.map((c) => (
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
            ))
          ) : (
            // No descifró (ver listOpenRiskAlerts): la alerta sigue abierta y se muestra igual.
            <Badge variant="secondary" className="text-[11px]">
              Detalle no disponible
            </Badge>
          )}
        </span>
      </Link>
      <AcknowledgeRiskAlertButton alertId={alert.id} />
    </li>
  );
}

function Phq9RiskAlertItem({ alert }: { alert: RiskAlert }) {
  // Esta fuente no tiene consulta (consultationId es null): se enlaza a la
  // ficha del paciente, donde está el historial de escalas.
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-line bg-card p-3 transition-shadow hover:shadow-sm">
      <Link href={`/patients/${alert.patientId}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="font-medium text-navy">{alert.patientName}</span>
        <Badge variant="secondary" className="bg-coral/15 text-[11px] text-destructive">
          Autolesión · PHQ-9
        </Badge>
      </Link>
      <AcknowledgeRiskAlertButton alertId={alert.id} />
    </li>
  );
}

/**
 * Lo que la lista no muestra. En la vista normal enlaza a la cola completa;
 * en la cola completa solo aparece si se supera el tope, y dice cuántas faltan.
 */
function HiddenRiskAlerts({
  queue,
  showAll,
  anchor,
  label,
}: {
  queue: RiskAlertQueue;
  showAll: boolean;
  anchor: string;
  label: string;
}) {
  const hidden = queue.total - queue.alerts.length;
  if (hidden <= 0) return null;
  const noun = hidden === 1 ? "alerta" : "alertas";
  if (showAll) {
    return (
      <p className="mt-2 text-xs font-medium text-destructive">
        Se muestran las {queue.alerts.length} más recientes: hay {hidden} {noun} {label} más{" "}
        {hidden === 1 ? "antigua" : "antiguas"} sin mostrar.
      </p>
    );
  }
  return (
    <Link
      href={`/dashboard?alerts=all#${anchor}`}
      className="mt-2 inline-block text-xs font-medium text-brand hover:underline"
    >
      Ver {hidden} {noun} más {label}
    </Link>
  );
}

/**
 * La cola PHQ-9 solo está completa si la conciliación registró cada PHQ-9 de
 * riesgo. Si no pudo, la página lo dice en vez de mostrar como completa una
 * cola a la que le pueden faltar alertas.
 */
function Phq9CheckNotice({ check }: { check: Phq9ReconcileResult | null }) {
  if (check && check.failed === 0) return null;
  const what = !check
    ? "No se pudo comprobar si hay cuestionarios PHQ-9 con riesgo sin registrar"
    : check.failed === 1
      ? "No se pudo revisar 1 cuestionario PHQ-9 en busca de riesgo"
      : `No se pudieron revisar ${check.failed} cuestionarios PHQ-9 en busca de riesgo`;
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-xl border border-coral/40 bg-card p-3 text-xs text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {what}: puede haber alertas que todavía no aparecen aquí. Recarga la página; si el aviso
        sigue, contacta a soporte.
      </span>
    </p>
  );
}

/**
 * Cola PHQ-9: primero concilia, para que todo PHQ-9 de riesgo tenga su alerta
 * en risk_alerts (ver reconcilePendingPhq9RiskAlerts), y recién después la
 * lee. Si la conciliación falla, la cola se lee igual y la página lo avisa.
 */
async function loadPhq9Queue(
  clinicId: string,
  limit: number,
): Promise<{ queue: RiskAlertQueue; check: Phq9ReconcileResult | null }> {
  let check: Phq9ReconcileResult | null = null;
  try {
    check = await reconcilePendingPhq9RiskAlerts(clinicId);
  } catch (error) {
    logger.error("dashboard.phq9_reconcile_failed", { clinicId, error });
  }
  return { queue: await listOpenRiskAlerts("phq9_self_report", limit), check };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ alerts?: string }>;
}) {
  const user = await getSessionUser();
  const isClinician = user?.role === "admin" || user?.role === "doctor";
  const { alerts: alertsView } = await searchParams;
  const showAllAlerts = alertsView === "all";
  const alertLimit = showAllAlerts ? RISK_ALERT_FULL_QUEUE : RISK_ALERT_PREVIEW;

  // Solo el personal clínico ve contenido de reportes/riesgo (la secretaría no).
  const [
    patients,
    todayAppts,
    pendingReports,
    patientsNoConsent,
    sessionAlerts,
    phq9,
    billing,
    verification,
  ] =
    await Promise.all([
      patientCount(),
      listTodayAppointments(),
      isClinician ? countPendingReports() : Promise.resolve(0),
      countPatientsWithoutConsent(),
      // Una consulta por fuente, cada una con su total: el encabezado suma
      // totales reales y cada lista dice cuántas deja fuera. Filtrar por fuente
      // en la base también evita que una alerta PHQ-9 (consultationId null)
      // termine con un enlace roto a /consultations/null.
      isClinician
        ? listOpenRiskAlerts("session_analysis", alertLimit)
        : Promise.resolve(EMPTY_QUEUE),
      isClinician && user ? loadPhq9Queue(user.clinicId, alertLimit) : Promise.resolve(null),
      // El aviso de cobro nunca debe tumbar el dashboard, que es donde están las
      // alertas de riesgo: si la consulta falla, se registra y la página sigue.
      isClinician
        ? getClinicSubscription().catch((error) => {
            logger.error("dashboard.billing_status_failed", { clinicId: user?.clinicId, error });
            return null;
          })
        : Promise.resolve(null),
      // Mismo criterio que el aviso de cobro: si falla, se registra y la página
      // sigue sin el aviso de verificación heredada.
      isClinician && user
        ? getMyVerification(user.id).catch((error) => {
            logger.error("dashboard.verification_status_failed", { userId: user.id, error });
            return null;
          })
        : Promise.resolve(null),
    ]);

  const phq9Alerts = phq9?.queue ?? EMPTY_QUEUE;
  const phq9CheckIncomplete = phq9 !== null && (phq9.check === null || phq9.check.failed > 0);
  const totalRiskAlerts = sessionAlerts.total + phq9Alerts.total;

  const firstName = user?.fullName.split(" ")[0] ?? "";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Hola, {firstName} 👋</h1>
        {/* first-letter y no capitalize: formatFullDate devuelve "jueves, 20 de
            agosto de 2026" —en español los días y meses van en minúscula— y
            `capitalize` capitaliza CADA palabra, produciendo "Jueves, 20 De
            Agosto De 2026". Solo hace falta la inicial de la frase. */}
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {formatFullDate(new Date().toISOString())}
        </p>
      </div>

      {/* Verificación pendiente: sin ella las rutas clínicas redirigen sin más
          contexto, así que el aviso va antes que nada. */}
      {user && (
        <VerificationBanner
          status={user.verificationStatus}
          legacy={
            verification ? legacyVerificationState({ ...verification, role: user.role }) : "none"
          }
        />
      )}

      {/* Renovación sin cobrar: la primera noticia de la gracia no puede ser el
          paso a Free. */}
      {billing && <BillingOverdueBanner plan={billing.plan} subscription={billing.subscription} />}

      {/* Alertas de riesgo — lo más importante arriba */}
      {isClinician && (totalRiskAlerts > 0 || phq9CheckIncomplete) && (
        <section className="rounded-2xl border border-coral/40 bg-coral/5 p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            <h2 className="font-heading font-semibold text-navy">
              Alertas de riesgo ({totalRiskAlerts})
            </h2>
            {showAllAlerts && (
              <Link href="/dashboard" className="ml-auto text-xs text-brand hover:underline">
                Ver solo las más recientes
              </Link>
            )}
          </div>
          {sessionAlerts.total > 0 && (
            <>
              <h3
                id="risk-alerts-ia-heading"
                className="mb-1.5 scroll-mt-24 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                De consultas (IA)
              </h3>
              <ul className="space-y-2" aria-labelledby="risk-alerts-ia-heading">
                {sessionAlerts.alerts.map((a) => (
                  <SessionRiskAlertItem
                    key={a.id}
                    alert={a}
                    href={`/consultations/${a.consultationId}`}
                  />
                ))}
              </ul>
              <HiddenRiskAlerts
                queue={sessionAlerts}
                showAll={showAllAlerts}
                anchor="risk-alerts-ia-heading"
                label="de consultas"
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Detección temprana por IA — apoyo a tu criterio, nunca un diagnóstico.
              </p>
            </>
          )}
          {phq9Alerts.total > 0 && (
            <>
              <h3
                id="risk-alerts-phq9-heading"
                className={cn(
                  "mb-1.5 scroll-mt-24 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                  sessionAlerts.total > 0 && "mt-4",
                )}
              >
                De cuestionarios (PHQ-9)
              </h3>
              <ul className="space-y-2" aria-labelledby="risk-alerts-phq9-heading">
                {phq9Alerts.alerts.map((a) => (
                  <Phq9RiskAlertItem key={a.id} alert={a} />
                ))}
              </ul>
              <HiddenRiskAlerts
                queue={phq9Alerts}
                showAll={showAllAlerts}
                anchor="risk-alerts-phq9-heading"
                label="de cuestionarios"
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Autolesión reportada directamente por el paciente en el PHQ-9 — no es una
                detección por IA.
              </p>
            </>
          )}
          {phq9 && <Phq9CheckNotice check={phq9.check} />}
        </section>
      )}

      {/* Pendientes */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatLink
          href="/patients"
          icon={Users}
          label="Pacientes"
          value={patients}
          accent="text-brand"
        />
        <StatLink
          href="/appointments"
          icon={CalendarDays}
          label="Citas hoy"
          value={todayAppts.length}
          accent="text-brand"
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
          <Link href="/appointments" className="text-sm text-brand hover:underline">
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
