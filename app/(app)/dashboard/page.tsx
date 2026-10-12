import Link from "next/link";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FileWarning,
  Lock,
  Plus,
  ShieldAlert,
  Users,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listTodayAppointments } from "@/lib/db/appointments";
import { countPendingReports } from "@/lib/db/reports";
import { countUnreviewedConsultations } from "@/lib/db/consultations";
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
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { VerificationBanner } from "@/components/verification-banner";
import { PageHeader } from "@/components/ui/page-header";
import { BillingOverdueBanner } from "@/components/billing-overdue-banner";
import { cn } from "@/lib/utils";
import { acknowledgeRiskAlertAction } from "./actions";

const APPT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  completed: "Completada",
  no_show: "No asistió",
};

const APPT_STATUS_TONE: Record<string, StatusTone> = {
  scheduled: "neutral",
  confirmed: "info",
  completed: "success",
  no_show: "warning",
};

/** Tratamientos que se escriben antes del nombre ("Dra. Ana Gómez"). */
const HONORIFIC = /^(dra?|lic|psic?|ps|mg|mag)\.?$/i;

/**
 * Cómo saludar: "Dra. Ana" en vez de "Dra." a secas. Si el nombre empieza con
 * un tratamiento, se conserva junto al nombre de pila.
 */
function greetingName(fullName: string): string {
  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length > 1 && HONORIFIC.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  return parts[0] ?? "";
}

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
        className="h-8 shrink-0 rounded-lg border border-gray-line bg-card px-3 text-xs font-medium text-navy transition-colors hover:border-success-border hover:bg-success-soft hover:text-success"
      >
        Acusar recibo
      </button>
    </form>
  );
}

function SessionRiskAlertItem({ alert, href }: { alert: RiskAlert; href: string }) {
  return (
    <li className="flex flex-col items-start gap-3 rounded-xl border border-danger-border bg-card p-3 transition-shadow hover:shadow-sm sm:flex-row sm:items-center">
      <Link href={href} className="flex w-full min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md">
        <span className="font-semibold text-navy">{alert.patientName}</span>
        <span className="flex flex-wrap gap-1.5">
          {alert.categories ? (
            alert.categories.map((c) => (
              <StatusBadge key={c.key} tone={c.level === "alto" ? "danger" : "warning"} dot>
                {RISK_CATEGORY_LABEL[c.key]} · {c.level}
              </StatusBadge>
            ))
          ) : (
            // No descifró (ver listOpenRiskAlerts): la alerta sigue abierta y se muestra igual.
            <StatusBadge>Detalle no disponible</StatusBadge>
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
    <li className="flex flex-col items-start gap-3 rounded-xl border border-danger-border bg-card p-3 transition-shadow hover:shadow-sm sm:flex-row sm:items-center">
      <Link href={`/patients/${alert.patientId}`} className="flex w-full min-w-0 flex-1 flex-wrap items-center gap-2 rounded-md">
        <span className="font-semibold text-navy">{alert.patientName}</span>
        <StatusBadge tone="danger" dot>
          Autolesión · PHQ-9
        </StatusBadge>
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
      <p className="mt-2 text-sm font-medium text-destructive">
        Se muestran las {queue.alerts.length} más recientes: hay {hidden} {noun} {label} más{" "}
        {hidden === 1 ? "antigua" : "antiguas"} sin mostrar.
      </p>
    );
  }
  return (
    <Link
      href={`/dashboard?alerts=all#${anchor}`}
      className="mt-2 inline-block rounded-md text-sm font-medium text-brand hover:underline"
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
      className="mt-4 flex items-start gap-2 rounded-xl border border-danger-border bg-card p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {what}: puede haber alertas que todavía no aparecen aquí. Recarga la página; si el aviso
        sigue, contacta a soporte.
      </span>
    </p>
  );
}

/**
 * Consultas cuyo análisis falló: no fueron revisadas en busca de riesgo.
 *
 * Sin este aviso, un dashboard sin alertas se lee como "ninguna sesión tiene
 * riesgo", cuando puede significar "ninguna sesión llegó a evaluarse" —
 * p. ej. si el proveedor de IA está caído o sin cupo. Mismo criterio que
 * Phq9CheckNotice: una cola incompleta se declara, no se presenta completa.
 */
function UnreviewedConsultationsNotice({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-xl border border-danger-border bg-card p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {count === 1
          ? "1 consulta no pudo analizarse y quedó sin revisar en busca de riesgo"
          : `${count} consultas no pudieron analizarse y quedaron sin revisar en busca de riesgo`}
        : que no aparezcan alertas de esas sesiones no significa que no haya riesgo. Ábrelas y
        reintenta el análisis, o revisa la transcripción con tu criterio.
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
    unreviewedConsultations,
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
      // Igual que el aviso de cobro: si esta consulta falla, no debe tumbar el
      // dashboard. Se registra y la página sigue (sin el aviso).
      isClinician
        ? countUnreviewedConsultations().catch((error) => {
            logger.error("dashboard.unreviewed_consultations_failed", {
              clinicId: user?.clinicId,
              error,
            });
            return 0;
          })
        : Promise.resolve(0),
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

  const name = greetingName(user?.fullName ?? "");

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title={<>Hola, {name}</>}
        description={
          // first-letter y no capitalize: formatFullDate devuelve "jueves, 20 de
          // agosto de 2026" —en español los días y meses van en minúscula— y
          // `capitalize` capitaliza CADA palabra. Solo hace falta la inicial.
          <p className="first-letter:uppercase">
            {formatFullDate(new Date().toISOString())}
            {user?.clinicName && <span className="text-muted-foreground"> · {user.clinicName}</span>}
          </p>
        }
        actions={
          <>
            <Link href="/appointments/new" className={cn(buttonVariants({ variant: "outline" }))}>
              <CalendarDays className="size-4" />
              Agendar cita
            </Link>
            <Link href="/patients/new" className={cn(buttonVariants())}>
              <Plus className="size-4" />
              Nuevo paciente
            </Link>
          </>
        }
      />

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
      {isClinician &&
        (totalRiskAlerts > 0 || phq9CheckIncomplete || unreviewedConsultations > 0) && (
        <section
          aria-labelledby="risk-alerts-heading"
          className="overflow-hidden rounded-2xl border border-danger-border bg-danger-soft"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-danger-border px-5 py-4">
            <span className="grid size-9 place-items-center rounded-lg bg-card text-destructive">
              <ShieldAlert className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="risk-alerts-heading" className="font-semibold text-destructive">
                Alertas de riesgo ({totalRiskAlerts})
              </h2>
              <p className="text-xs text-foreground/80">Revisa cada paciente y acusa recibo cuando lo hayas atendido.</p>
            </div>
            {showAllAlerts && (
              <Link href="/dashboard" className="rounded-md text-sm font-medium text-brand hover:underline">
                Ver solo las más recientes
              </Link>
            )}
          </div>
          <div className="space-y-5 p-5">
            {sessionAlerts.total > 0 && (
              <div>
                <h3
                  id="risk-alerts-ia-heading"
                  className="mb-2 scroll-mt-24 text-xs font-semibold tracking-wide text-foreground/80 uppercase"
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
                <p className="mt-3 text-xs text-foreground/80">
                  Detección temprana por IA — apoyo a tu criterio, nunca un diagnóstico.
                </p>
              </div>
            )}
            {phq9Alerts.total > 0 && (
              <div>
                <h3
                  id="risk-alerts-phq9-heading"
                  className="mb-2 scroll-mt-24 text-xs font-semibold tracking-wide text-foreground/80 uppercase"
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
                <p className="mt-3 text-xs text-foreground/80">
                  Autolesión reportada directamente por el paciente en el PHQ-9 — no es una
                  detección por IA.
                </p>
              </div>
            )}
            {phq9 && <Phq9CheckNotice check={phq9.check} />}
            <UnreviewedConsultationsNotice count={unreviewedConsultations} />
          </div>
        </section>
      )}

      {/* Pendientes primero, contexto después */}
      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {isClinician && (
          <StatLink
            href="/reports"
            icon={ClipboardCheck}
            label="Reportes por validar"
            value={pendingReports}
            pending
            doneLabel="Todos validados"
            pendingLabel="Esperan tu firma"
          />
        )}
        <StatLink
          href="/patients"
          icon={FileWarning}
          label="Sin consentimiento"
          value={patientsNoConsent}
          pending
          doneLabel="Todos firmados"
          pendingLabel="No pueden iniciar consulta"
        />
        <StatLink
          href="/appointments"
          icon={CalendarDays}
          label="Citas hoy"
          value={todayAppts.length}
        />
        <StatLink href="/patients" icon={Users} label="Pacientes" value={patients} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Agenda de hoy */}
        <section className="rounded-2xl border border-gray-line bg-card lg:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-gray-line px-5 py-4 md:px-6">
            <h2 className="font-semibold text-navy">Agenda de hoy</h2>
            <Link href="/appointments" className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand hover:underline">
              Ver toda la agenda
              <ChevronRight className="size-4" />
            </Link>
          </div>
          {todayAppts.length === 0 ? (
            <EmptyState
              compact
              icon={CalendarDays}
              title="No tienes citas para hoy."
              description="Las citas que agendes para hoy aparecerán aquí en orden."
              action={
                <Link href="/appointments/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  <Plus className="size-4" />
                  Agendar cita
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-gray-line">
              {todayAppts.map((a) => (
                <li key={a.id} className="flex items-center gap-4 px-5 py-3.5 md:px-6">
                  <span className="w-14 shrink-0 text-base font-semibold tabular-nums text-navy">
                    {formatTime(a.scheduledAt)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-navy">{a.patientName}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.doctorName}</p>
                  </div>
                  <StatusBadge tone={APPT_STATUS_TONE[a.status] ?? "neutral"}>
                    {APPT_STATUS_LABEL[a.status] ?? a.status}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Garantías de seguridad: discretas, pero visibles en la primera pantalla */}
        <section className="h-fit rounded-2xl border border-gray-line bg-card p-5 md:p-6">
          <h2 className="flex items-center gap-2 font-semibold text-navy">
            <Lock className="size-4 text-success" />
            Protección de datos
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{user?.clinicName}</p>
          <ul className="mt-4 space-y-3 text-sm text-foreground/85">
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
              Datos cifrados (AES-256), aislados por clínica.
            </li>
            <li className="flex gap-2.5">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
              El audio de las sesiones no se graba ni se guarda.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

/**
 * Tarjeta de resumen. Las `pending` son tareas: con valor > 0 se marcan en
 * ámbar y dicen qué falta; en 0 confirman que están al día. Las demás son
 * contexto y se muestran neutras.
 */
function StatLink({
  href,
  icon: Icon,
  label,
  value,
  pending = false,
  pendingLabel,
  doneLabel,
}: {
  href: string;
  icon: typeof Users;
  label: string;
  value: number;
  pending?: boolean;
  pendingLabel?: string;
  doneLabel?: string;
}) {
  const needsAttention = pending && value > 0;
  const done = pending && value === 0;
  return (
    <Link
      href={href}
      className={cn(
        "group flex flex-col rounded-2xl border bg-card p-4 transition-shadow hover:shadow-md sm:p-5",
        needsAttention ? "border-warning-border" : "border-gray-line",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm leading-snug font-medium text-muted-foreground">{label}</span>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg",
            needsAttention ? "bg-warning-soft text-warning" : done ? "bg-success-soft text-success" : "bg-info-soft text-brand",
          )}
        >
          {needsAttention ? <AlertTriangle className="size-[18px]" /> : <Icon className="size-[18px]" />}
        </span>
      </div>
      <span className="mt-3 text-3xl font-semibold tracking-tight tabular-nums text-navy">{value}</span>
      {pending && (
        <span className={cn("mt-1 text-xs font-medium", needsAttention ? "text-warning" : "text-success")}>
          {needsAttention ? pendingLabel : doneLabel}
        </span>
      )}
    </Link>
  );
}
