import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TrendingUp, Target, ShieldAlert, Tags } from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { listReportsForPatient } from "@/lib/db/reports";
import { listAssessmentsForPatient } from "@/lib/db/assessments";
import { getLatestClinicalStateSnapshot } from "@/lib/db/clinical-state";
import type { ClinicalState } from "@/lib/clinical-state";
import { RISK_CATEGORY_LABEL } from "@/lib/risk-flags";
import type { RiskCategory } from "@/lib/risk-levels";
import { ASSESSMENT_LABEL, ASSESSMENT_MAX_SCORE, type AssessmentType } from "@/lib/psychometrics";
import { formatFullDate } from "@/lib/dates";
import { ScoreTrendChart } from "@/components/score-trend-chart";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ALL_RISK_CATEGORIES: RiskCategory[] = [
  "suicidal_ideation",
  "self_harm",
  "substance_use",
  "risk_to_others",
];

const OBJETIVO_ESTADO_LABEL: Record<ClinicalState["objetivos"][number]["estado"], string> = {
  activo: "Activos",
  logrado: "Logrados",
  abandonado: "Abandonados",
};

const OBJETIVO_ESTADO_STYLE: Record<ClinicalState["objetivos"][number]["estado"], string> = {
  activo: "bg-purple/15 text-purple",
  logrado: "bg-mint/15 text-[#04342a]",
  abandonado: "bg-muted text-muted-foreground",
};

const RIESGO_LEVEL_STYLE: Record<string, string> = {
  bajo: "border-amber-400/40 bg-amber-400/10 text-amber-800",
  moderado: "border-coral/40 bg-coral/10 text-[#7a2020]",
  alto: "border-destructive/50 bg-destructive/15 text-destructive",
};

const TENDENCIA_LABEL: Record<ClinicalState["temas"][number]["tendencia"], string> = {
  creciente: "↑ creciente",
  estable: "→ estable",
  decreciente: "↓ decreciente",
};

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

export default async function ProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const patient = await getPatient(id);
  if (!patient) notFound();

  const [reports, assessments, snapshot] = await Promise.all([
    listReportsForPatient(id),
    listAssessmentsForPatient(id),
    getLatestClinicalStateSnapshot(id),
  ]);

  const assessmentsByType = (["phq9", "gad7"] as AssessmentType[]).map((type) => ({
    type,
    points: assessments
      .filter((a) => a.type === type)
      .map((a) => ({ date: a.administeredAt, score: a.result.totalScore, severity: a.result.severity })),
  }));

  const state = snapshot?.state ?? null;
  const objetivosByEstado = state
    ? (["activo", "logrado", "abandonado"] as const).map((estado) => ({
        estado,
        items: state.objetivos.filter((o) => o.estado === estado),
      }))
    : [];
  const temasByFrequency = state ? [...state.temas].sort((a, b) => b.sesiones.length - a.sesiones.length) : [];

  const hasAnything = reports.length > 0 || assessments.length > 0 || Boolean(state);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/patients/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a la ficha
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">
          Evolución de {patient.fullName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Historial comparativo a partir de {reports.length}{" "}
          {reports.length === 1 ? "sesión analizada" : "sesiones analizadas"}.
        </p>
      </div>

      {!hasAnything ? (
        <div className="rounded-2xl border border-dashed border-gray-line bg-card p-12 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-cloud">
            <TrendingUp className="size-6 text-purple" />
          </div>
          <h3 className="font-heading font-semibold text-navy">Aún no hay sesiones analizadas</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Realiza una consulta para empezar a ver la evolución del paciente.
          </p>
        </div>
      ) : (
        <>
          {state && (
            <div className="rounded-2xl border border-gray-line bg-card p-6">
              <h2 className="mb-4 flex items-center gap-2 font-heading font-semibold text-navy">
                <Target className="size-4 text-purple" />
                Objetivos terapéuticos
              </h2>
              {state.objetivos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin objetivos registrados aún.</p>
              ) : (
                <div className="space-y-4">
                  {objetivosByEstado.map(
                    ({ estado, items }) =>
                      items.length > 0 && (
                        <div key={estado}>
                          <Badge className={cn("mb-2", OBJETIVO_ESTADO_STYLE[estado])}>
                            {OBJETIVO_ESTADO_LABEL[estado]} ({items.length})
                          </Badge>
                          <ul className="space-y-1.5">
                            {items.map((o) => (
                              <li key={o.id} className="text-sm text-navy">
                                {o.texto}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ),
                  )}
                </div>
              )}
            </div>
          )}

          {state && (
            <div className="rounded-2xl border border-gray-line bg-card p-6">
              <h2 className="mb-4 flex items-center gap-2 font-heading font-semibold text-navy">
                <ShieldAlert className="size-4 text-purple" />
                Riesgos identificados a lo largo del tratamiento
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {ALL_RISK_CATEGORIES.map((categoria) => {
                  const r = state.riesgos.find((x) => x.categoria === categoria);
                  return (
                    <div
                      key={categoria}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm",
                        r ? RIESGO_LEVEL_STYLE[r.nivel] : "border-gray-line text-muted-foreground",
                      )}
                    >
                      <p className="font-medium">{RISK_CATEGORY_LABEL[categoria]}</p>
                      <p className="text-xs">
                        {r ? `Nivel ${r.nivel} · ${r.estado === "activo" ? "activo" : "resuelto"}` : "Sin indicios registrados"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {temasByFrequency.length > 0 && (
            <div className="rounded-2xl border border-gray-line bg-card p-6">
              <h2 className="mb-4 flex items-center gap-2 font-heading font-semibold text-navy">
                <Tags className="size-4 text-purple" />
                Temas recurrentes
              </h2>
              <ul className="space-y-2">
                {temasByFrequency.map((t) => (
                  <li key={t.tema} className="flex items-center justify-between text-sm">
                    <span className="text-navy">{t.tema}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t.sesiones.length} {t.sesiones.length === 1 ? "sesión" : "sesiones"} ·{" "}
                      {TENDENCIA_LABEL[t.tendencia]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {assessmentsByType.map(
            ({ type, points }) =>
              points.length > 0 && (
                <div key={type} className="rounded-2xl border border-gray-line bg-card p-6">
                  <h2 className="mb-4 font-heading font-semibold text-navy">
                    Evolución {ASSESSMENT_LABEL[type]}
                  </h2>
                  <ScoreTrendChart points={points} max={ASSESSMENT_MAX_SCORE[type]} />
                  <div className="mt-2 flex justify-between px-4 text-xs text-muted-foreground">
                    {points.map((p, i) => (
                      <span key={i}>{shortDate(p.date)}</span>
                    ))}
                  </div>
                  <ul className="mt-4 divide-y divide-gray-line border-t border-gray-line">
                    {points.map((p, i) => (
                      <li key={i} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-navy">{shortDate(p.date)}</span>
                        <span className="text-muted-foreground">
                          {p.score}/{ASSESSMENT_MAX_SCORE[type]} · {p.severity}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
          )}

          {reports.length > 0 && (
            <div className="rounded-2xl border border-gray-line bg-card p-6">
              <h2 className="mb-3 font-heading font-semibold text-navy">Sesiones</h2>
              <ul className="divide-y divide-gray-line">
                {reports.map((r) => (
                  <li key={r.consultationId}>
                    <Link
                      href={`/consultations/${r.consultationId}`}
                      className="flex items-center justify-between py-2.5 text-sm hover:text-purple"
                    >
                      <span className="text-navy">{formatFullDate(r.date)}</span>
                      <span className="text-xs text-muted-foreground">
                        {r.validatedAt ? "Validado" : "Sin validar"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
