import { AlertTriangle, BadgeCheck, BrainCircuit, NotebookPen, ShieldAlert } from "lucide-react";
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
  bajo: "border-amber-400/40 bg-amber-400/10 text-amber-800",
  moderado: "border-coral/40 bg-coral/10 text-[#7a2020]",
  alto: "border-destructive/50 bg-destructive/15 text-destructive",
};

function RiskAlerts({ riskFlags }: { riskFlags: RiskFlags | undefined }) {
  if (!riskFlags) return null;
  const active = (Object.entries(riskFlags) as [keyof RiskFlags, RiskFlags[keyof RiskFlags]][])
    .filter(([, v]) => v.level !== "ninguno");

  if (active.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-line bg-card p-4 text-sm text-muted-foreground">
        No se identificaron alertas de riesgo (ideación suicida, autolesión, consumo de
        sustancias, riesgo a terceros) en esta sesión.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 font-heading font-semibold text-destructive">
        <ShieldAlert className="size-5" />
        Alertas de riesgo identificadas
      </div>
      <div className="space-y-2">
        {active.map(([key, v]) => (
          <div key={key} className={`rounded-lg border px-3 py-2 text-sm ${RISK_LEVEL_STYLE[v.level]}`}>
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
      <p className="text-xs text-muted-foreground">
        Detección de apoyo basada en las palabras del paciente. Requiere valoración y decisión
        clínica del profesional tratante.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-line bg-card p-6">
      <h3 className="mb-3 font-heading font-semibold text-navy">{title}</h3>
      {children}
    </section>
  );
}

export function ReportView({
  report,
  consultationId,
}: {
  report: Report;
  consultationId: string;
}) {
  const { payload } = report;

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="flex items-start gap-3 rounded-2xl border border-coral/30 bg-coral/5 p-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <p className="text-sm text-foreground/90">
          <span className="font-semibold text-navy">Apoyo clínico, no diagnóstico.</span> Este
          análisis es generado por IA y debe ser interpretado y validado por el profesional
          tratante. No constituye un diagnóstico médico ni psicológico.
        </p>
      </div>

      <RiskAlerts riskFlags={payload.riskFlags} />

      <div className="flex items-center gap-2 text-sm text-purple">
        <BrainCircuit className="size-4" />
        Análisis con IA {report.doctorEdited && "· editado por el profesional"}
      </div>

      <Section title="Resumen ejecutivo">
        <p className="text-sm leading-relaxed text-foreground/90">{payload.summary}</p>
      </Section>

      <Section title="Patrones lingüísticos">
        <div className="space-y-2.5">
          {Object.entries(payload.patterns).map(([key, value]) => (
            <div key={key}>
              <div className="flex justify-between text-xs">
                <span className="text-foreground/80">{PATTERN_LABEL[key] ?? key}</span>
                <span className="text-muted-foreground">{(value * 100).toFixed(1)}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-purple"
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

      <Section title="Validación del profesional">
        {report.validatedAt ? (
          <p className="flex items-center gap-2 text-sm text-mint">
            <BadgeCheck className="size-4" />
            Reporte validado el {new Date(report.validatedAt).toLocaleString("es-CO")}
          </p>
        ) : (
          <form action={validateReportAction.bind(null, report.id, consultationId)}>
            <p className="mb-3 text-sm text-muted-foreground">
              Al validar, firmas este reporte como profesional tratante.
            </p>
            <Button type="submit" size="sm">
              <BadgeCheck className="size-4" />
              Validar y firmar reporte
            </Button>
          </form>
        )}
      </Section>
    </div>
  );
}
