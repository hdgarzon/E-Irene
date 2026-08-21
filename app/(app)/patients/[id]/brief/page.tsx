import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  Target,
  ShieldAlert,
  Lightbulb,
  Wrench,
  Mic,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { listAssessmentsForPatient } from "@/lib/db/assessments";
import { getLatestClinicalStateSnapshot } from "@/lib/db/clinical-state";
import { whatsNewInSession, type ClinicalState } from "@/lib/clinical-state";
import { RISK_CATEGORY_LABEL } from "@/lib/risk-flags";
import { ASSESSMENT_LABEL, ASSESSMENT_MAX_SCORE, type AssessmentType } from "@/lib/psychometrics";
import { computeTreatmentTrend, type TreatmentTrendStatus } from "@/lib/treatment-trend";
import { formatFullDate } from "@/lib/dates";
import { ScoreTrendChart } from "@/components/score-trend-chart";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RISK_LEVEL_STYLE: Record<string, string> = {
  bajo: "border-amber-400/40 bg-amber-400/10 text-amber-800",
  moderado: "border-coral/40 bg-coral/10 text-[#7a2020]",
  alto: "border-destructive/50 bg-destructive/15 text-destructive",
};

const TREND_META: Record<
  TreatmentTrendStatus,
  { label: string; icon: typeof TrendingUp; className: string }
> = {
  improving: { label: "Mejora clínicamente significativa", icon: TrendingUp, className: "bg-mint/15 text-[#04342a]" },
  stable: { label: "Sin cambio significativo", icon: Minus, className: "bg-amber-100 text-amber-800" },
  worsening: { label: "Empeoramiento clínicamente significativo", icon: TrendingDown, className: "bg-coral/15 text-destructive" },
  insufficient_data: { label: "Aún no hay suficientes mediciones", icon: Minus, className: "bg-cloud text-muted-foreground" },
};

function EvidenceLine({ evidencia, confianza }: { evidencia: string; confianza?: number }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      &ldquo;{evidencia}&rdquo;
      {confianza !== undefined && <span className="ml-1.5">· confianza {Math.round(confianza * 100)}%</span>}
    </p>
  );
}

function Section({
  icon: Icon,
  title,
  accent,
  children,
}: {
  icon: typeof Target;
  title: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-line bg-card p-6">
      <h2 className={cn("mb-4 flex items-center gap-2 font-heading font-semibold text-navy", accent)}>
        <Icon className="size-4" />
        {title}
      </h2>
      {children}
    </div>
  );
}

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();

  const [snapshot, assessments] = await Promise.all([
    getLatestClinicalStateSnapshot(id),
    listAssessmentsForPatient(id),
  ]);

  const assessmentsByType = (["phq9", "gad7"] as AssessmentType[]).map((type) => ({
    type,
    points: assessments
      .filter((a) => a.type === type)
      .map((a) => ({ date: a.administeredAt, score: a.result.totalScore, severity: a.result.severity })),
  }));

  const treatmentTrends = (["phq9", "gad7"] as AssessmentType[])
    .map((type) => computeTreatmentTrend(assessments, type))
    .filter((t) => t.assessmentCount > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/patients/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a la ficha
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">
            Brief pre-sesión — {patient.fullName}
          </h1>
          {snapshot && (
            <p className="text-sm text-muted-foreground">
              Estado actualizado el {formatFullDate(snapshot.createdAt)}.
            </p>
          )}
        </div>
        <Link href={`/consultations/new?patientId=${id}`} className={cn(buttonVariants())}>
          <Mic className="size-4" />
          Iniciar consulta
        </Link>
      </div>

      {!snapshot && assessments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <Sparkles className="size-6 text-brand" />
          </div>
          <h3 className="font-heading font-semibold text-navy">Aún no hay estado clínico</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            El brief se construye con lo que la IA identifica en cada sesión analizada. Realiza la
            primera consulta con este paciente para empezar a verlo.
          </p>
        </div>
      ) : (
        <>
          {snapshot && <BriefContent snapshot={snapshot} />}

          {treatmentTrends.length > 0 && (
            <Section icon={Activity} title="Progreso del tratamiento">
              <div className="space-y-3">
                {treatmentTrends.map((t) => {
                  const meta = TREND_META[t.status];
                  const TrendIcon = meta.icon;
                  return (
                    <div key={t.type} className="flex items-center justify-between gap-3 rounded-lg border border-gray-line px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-navy">{ASSESSMENT_LABEL[t.type]}</p>
                        {t.status === "insufficient_data" ? (
                          <p className="text-xs text-muted-foreground">
                            {t.assessmentCount} {t.assessmentCount === 1 ? "medición registrada" : "mediciones registradas"} — se necesitan al menos 3 para evaluar tendencia.
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {t.baseline!.score} → {t.latest!.score} desde el inicio del tratamiento
                            ({t.assessmentCount} mediciones)
                          </p>
                        )}
                      </div>
                      <Badge className={cn("shrink-0 gap-1", meta.className)}>
                        <TrendIcon className="size-3" />
                        {meta.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Compara la medición más reciente contra la primera registrada, usando el cambio
                mínimo clínicamente importante de cada escala (umbral estándar de la literatura,
                pendiente de validación clínica propia para esta población). No atribuye el cambio
                a ninguna técnica ni intervención — eso queda enteramente a tu criterio.
              </p>
            </Section>
          )}

          {assessmentsByType.some(({ points }) => points.length > 0) && (
            <Section icon={Sparkles} title="Tendencia de escalas psicométricas">
              <div className="space-y-6">
                {assessmentsByType.map(
                  ({ type, points }) =>
                    points.length > 0 && (
                      <div key={type}>
                        <p className="mb-2 text-sm font-medium text-navy">{ASSESSMENT_LABEL[type]}</p>
                        <ScoreTrendChart points={points} max={ASSESSMENT_MAX_SCORE[type]} />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Último: {points[points.length - 1].score}/{ASSESSMENT_MAX_SCORE[type]} ·{" "}
                          {points[points.length - 1].severity}
                        </p>
                      </div>
                    ),
                )}
              </div>
            </Section>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Generado por IA a partir de las palabras del paciente en sesiones anteriores — apoyo a tu
        criterio clínico, nunca un diagnóstico ni un plan de tratamiento automatizado. Cada
        observación puede verificarse contra la cita textual que la sustenta.
      </p>
    </div>
  );
}

function BriefContent({
  snapshot,
}: {
  snapshot: { state: ClinicalState; consultationId: string | null };
}) {
  const { state, consultationId } = snapshot;
  const changes = consultationId ? whatsNewInSession(state, consultationId) : null;
  const objetivosActivos = state.objetivos.filter((o) => o.estado === "activo");
  const riesgosActivos = state.riesgos.filter((r) => r.estado === "activo");

  return (
    <>
      {changes && (
        <Section icon={Sparkles} title="Qué cambió en la última sesión" accent="text-brand">
          {changes.objetivos.length === 0 &&
          changes.riesgos.length === 0 &&
          changes.temas.length === 0 &&
          changes.hipotesis.length === 0 &&
          changes.tecnicas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              La última sesión no aportó cambios nuevos al estado del paciente.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {changes.objetivos.map((o) => (
                <li key={o.id}>
                  <span className="text-navy">
                    Objetivo <strong>{o.estado}</strong>: {o.texto}
                  </span>
                  <EvidenceLine evidencia={o.evidencia} confianza={o.confianza} />
                </li>
              ))}
              {changes.riesgos.map((r) => (
                <li key={r.categoria}>
                  <span className="text-navy">
                    Riesgo {r.estado === "activo" ? "activo" : "resuelto"}: {RISK_CATEGORY_LABEL[r.categoria]}{" "}
                    ({r.nivel})
                  </span>
                  <EvidenceLine evidencia={r.evidencia} />
                </li>
              ))}
              {changes.temas.map((t) => (
                <li key={t.tema}>
                  <span className="text-navy">
                    Tema {t.tendencia}: {t.tema}
                  </span>
                  <EvidenceLine evidencia={t.evidencia} />
                </li>
              ))}
              {changes.hipotesis.map((h) => (
                <li key={h.texto}>
                  <span className="text-navy">Hipótesis reafirmada: {h.texto}</span>
                  <EvidenceLine evidencia={h.evidencia[h.evidencia.length - 1]} confianza={h.confianza} />
                </li>
              ))}
              {changes.tecnicas.map((t) => (
                <li key={t.tecnica}>
                  <span className="text-navy">Técnica usada: {t.tecnica}</span>
                  <EvidenceLine evidencia={t.evidencia} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {riesgosActivos.length > 0 && (
        <Section icon={ShieldAlert} title="Riesgos activos" accent="text-destructive">
          <div className="space-y-2">
            {riesgosActivos.map((r) => (
              <div key={r.categoria} className={cn("rounded-lg border px-3 py-2 text-sm", RISK_LEVEL_STYLE[r.nivel])}>
                <p className="font-medium">
                  {RISK_CATEGORY_LABEL[r.categoria]} — nivel {r.nivel}
                </p>
                {r.evidencia && <p className="mt-0.5 text-foreground/80">&ldquo;{r.evidencia}&rdquo;</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section icon={Target} title="Objetivos activos">
        {objetivosActivos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin objetivos activos registrados aún.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {objetivosActivos.map((o) => (
              <li key={o.id}>
                <span className="text-navy">{o.texto}</span>
                <EvidenceLine evidencia={o.evidencia} confianza={o.confianza} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {(state.hipotesis.length > 0 || state.tecnicas.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {state.hipotesis.length > 0 && (
            <Section icon={Lightbulb} title="Hipótesis clínicas">
              <ul className="space-y-2">
                {state.hipotesis.map((h) => (
                  <li key={h.texto} className="text-sm">
                    <span className="text-navy">{h.texto}</span>
                    <Badge variant="secondary" className="ml-1.5 text-[10px]">
                      {Math.round(h.confianza * 100)}%
                    </Badge>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {state.tecnicas.length > 0 && (
            <Section icon={Wrench} title="Técnicas usadas">
              <ul className="space-y-2">
                {state.tecnicas.map((t) => (
                  <li key={t.tecnica} className="text-sm">
                    <p className="text-navy">{t.tecnica}</p>
                    <p className="text-xs text-muted-foreground">{t.respuestaPaciente}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
