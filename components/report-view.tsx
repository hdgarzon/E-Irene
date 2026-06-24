import { AlertTriangle, BadgeCheck, BrainCircuit } from "lucide-react";
import type { Report } from "@/lib/db/reports";
import { validateReportAction } from "@/app/(app)/consultations/actions";
import { SuggestionEditor } from "@/components/suggestion-editor";
import { Button } from "@/components/ui/button";

const SENTIMENT_COLOR: Record<string, string> = {
  positivo: "#00d4aa",
  neutral: "#635bff",
  negativo: "#ff6b6b",
};

const PATTERN_LABEL: Record<string, string> = {
  primera_persona: "Uso de primera persona",
  negaciones: "Negaciones",
  dudas: "Expresiones de duda",
  intensidad_emocional: "Intensidad emocional",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-line bg-card p-6">
      <h3 className="mb-3 font-heading font-semibold text-navy">{title}</h3>
      {children}
    </section>
  );
}

function SentimentTimeline({
  timeline,
}: {
  timeline: { position: number; score: number }[];
}) {
  const w = 100;
  const h = 36;
  const pts = timeline
    .map((p) => `${p.position * w},${h / 2 - (p.score * h) / 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none">
      <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="#e3e8ee" strokeWidth="0.5" />
      <polyline
        points={pts}
        fill="none"
        stroke="#635bff"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
  const sentimentPct = Math.round(((payload.sentiment.score + 1) / 2) * 100);
  const maxWeight = Math.max(...payload.keywords.map((k) => k.weight), 1);

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

      <div className="flex items-center gap-2 text-sm text-purple">
        <BrainCircuit className="size-4" />
        Análisis con IA {report.doctorEdited && "· editado por el profesional"}
      </div>

      <Section title="Resumen ejecutivo">
        <p className="text-sm leading-relaxed text-foreground/90">{payload.summary}</p>
      </Section>

      <Section title="Análisis de sentimiento">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Tono general</span>
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
            style={{
              backgroundColor: `${SENTIMENT_COLOR[payload.sentiment.label]}22`,
              color: SENTIMENT_COLOR[payload.sentiment.label],
            }}
          >
            {payload.sentiment.label} ({payload.sentiment.score.toFixed(2)})
          </span>
        </div>
        <div className="mb-1 h-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-coral/30 via-purple/20 to-mint/30">
          <div className="h-full w-0.5 bg-navy" style={{ marginLeft: `${sentimentPct}%` }} />
        </div>
        <div className="mt-4">
          <p className="mb-1 text-xs text-muted-foreground">Evolución emocional durante la sesión</p>
          <SentimentTimeline timeline={payload.sentiment.timeline} />
        </div>
      </Section>

      <Section title="Nube de palabras y temas">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {payload.keywords.map((k, i) => (
            <span
              key={k.term}
              className="font-heading font-semibold"
              style={{
                fontSize: `${0.85 + (k.weight / maxWeight) * 0.9}rem`,
                color: ["#635bff", "#0a2540", "#00d4aa"][i % 3],
              }}
            >
              {k.term}
            </span>
          ))}
        </div>
        {payload.topics.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Temas recurrentes: {payload.topics.join(", ")}.
          </p>
        )}
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
