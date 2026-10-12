import { BadgeCheck, BrainCircuit, Info, NotebookPen, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Report } from "@/lib/db/reports";
import type { RiskFlags } from "@/lib/providers/types";
import { validateReportAction } from "@/app/(app)/consultations/actions";
import { SuggestionEditor } from "@/components/suggestion-editor";
import { DoctorNotesEditor } from "@/components/doctor-notes-editor";
import { Button } from "@/components/ui/button";

const PATTERN_LABEL: Record<string, string> = {
  primera_persona: "Uso de primera persona",
  negaciones: "Negaciones",
  dudas: "Expresiones de duda",
  intensidad_emocional: "Intensidad emocional",
};

const RISK_LABEL: Record<keyof RiskFlags, string> = {
  suicidal_ideation: "Ideación suicida",
  self_harm: "Autolesión",
  substance_use: "Consumo de sustancias",
  risk_to_others: "Riesgo a terceros",
};

const RISK_LEVEL_STYLE: Record<string, string> = {
  bajo: "border-warning-border bg-warning-soft text-warning",
  moderado: "border-danger-border bg-card text-destructive",
  alto: "border-destructive bg-danger-soft text-destructive",
};

export function RiskAlerts({ riskFlags }: { riskFlags: RiskFlags | undefined }) {
  if (!riskFlags) return null;
  const active = (Object.entries(riskFlags) as [keyof RiskFlags, RiskFlags[keyof RiskFlags]][])
    .filter(([, v]) => v.level !== "ninguno");

  if (active.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-success-border bg-success-soft p-4 text-sm text-foreground/85">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        <p>
          No se identificaron alertas de riesgo (ideación suicida, autolesión, consumo de
          sustancias, riesgo a terceros) en esta sesión.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-danger-border bg-danger-soft p-4">
      <div className="flex items-center gap-2 font-semibold text-destructive">
        <ShieldAlert className="size-5" />
        Alertas de riesgo identificadas
      </div>
      <div className="space-y-2">
        {active.map(([key, v]) => (
          <div key={key} className={`rounded-lg border px-3 py-2.5 text-sm ${RISK_LEVEL_STYLE[v.level]}`}>
            {/* Sin `capitalize`: RISK_LABEL ya trae la capitalización correcta
                ("Ideación suicida", "Consumo de sustancias") y capitalizar cada
                palabra las rompía —"Consumo De Sustancias"—. "nivel moderado"
                va en minúscula, que es lo correcto a media frase. */}
            <p className="font-medium">
              {RISK_LABEL[key]} — nivel {v.level}
            </p>
            {v.evidence && <p className="mt-0.5 text-foreground/80">&ldquo;{v.evidence}&rdquo;</p>}
          </div>
        ))}
      </div>
      <p className="text-xs text-foreground/80">
        Detección de apoyo basada en las palabras del paciente. Requiere valoración y decisión
        clínica del profesional tratante.
      </p>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-navy">
        {Icon && <Icon className="size-4 text-brand" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Descargo del análisis. Va en tono informativo, no de alarma: el rojo se
 * reserva para las alertas de riesgo, que deben destacar sobre todo lo demás.
 */
export function ReportDisclaimer() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-info-border bg-info-soft p-4">
      <Info className="mt-0.5 size-4 shrink-0 text-brand" />
      <p className="text-sm text-foreground/90">
        <span className="font-semibold text-navy">Apoyo clínico, no diagnóstico.</span> Este
        análisis es generado por IA y debe ser interpretado y validado por el profesional
        tratante. No constituye un diagnóstico médico ni psicológico.
      </p>
    </div>
  );
}

/** Contenido del análisis: resumen, patrones, sugerencia y notas privadas. */
export function ReportBody({ report, consultationId }: { report: Report; consultationId: string }) {
  const { payload } = report;
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-medium text-brand">
        <BrainCircuit className="size-4" />
        Análisis con IA {report.doctorEdited && "· editado por el profesional"}
      </p>

      <Section title="Resumen ejecutivo">
        <p className="text-[0.9375rem] leading-relaxed text-foreground/90">{payload.summary}</p>
      </Section>

      <Section title="Patrones lingüísticos">
        <div className="space-y-3">
          {Object.entries(payload.patterns).map(([key, value]) => (
            <div key={key}>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/85">{PATTERN_LABEL[key] ?? key}</span>
                <span className="font-medium tabular-nums text-muted-foreground">
                  {(value * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(value * 100 * 4, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Sugerencia preliminar (editable)">
        <SuggestionEditor
          reportId={report.id}
          consultationId={consultationId}
          suggestion={payload.suggestion}
          doctorEdited={report.doctorEdited}
        />
      </Section>

      <Section title="Notas privadas del profesional">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <NotebookPen className="size-3.5" />
          Escritas por ti — no generadas por IA, no visibles para el paciente.
        </div>
        <DoctorNotesEditor
          reportId={report.id}
          consultationId={consultationId}
          notes={report.doctorNotes}
        />
      </Section>
    </div>
  );
}

/** Firma del reporte por el profesional tratante. */
export function ReportValidation({ report, consultationId }: { report: Report; consultationId: string }) {
  return (
    <Section title="Validación del profesional" icon={BadgeCheck}>
      {report.validatedAt ? (
        <p className="flex items-start gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm font-medium text-success">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          Reporte validado el {new Date(report.validatedAt).toLocaleString("es-CO")}
        </p>
      ) : (
        <form action={validateReportAction.bind(null, report.id, consultationId)}>
          <p className="mb-4 text-sm text-muted-foreground">
            Al validar, firmas este reporte como profesional tratante.
          </p>
          <Button type="submit" className="w-full">
            <BadgeCheck className="size-4" />
            Validar y firmar reporte
          </Button>
        </form>
      )}
    </Section>
  );
}

export function ReportView({
  report,
  consultationId,
}: {
  report: Report;
  consultationId: string;
}) {
  return (
    <div className="space-y-4">
      <ReportDisclaimer />
      <RiskAlerts riskFlags={report.payload.riskFlags} />
      <ReportBody report={report} consultationId={consultationId} />
      <ReportValidation report={report} consultationId={consultationId} />
    </div>
  );
}
