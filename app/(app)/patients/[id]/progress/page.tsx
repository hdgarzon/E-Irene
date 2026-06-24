import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getPatient } from "@/lib/db/patients";
import { listReportsForPatient } from "@/lib/db/reports";
import {
  sentimentTrend,
  aggregateKeywords,
  averageSentiment,
} from "@/lib/progress";
import { SentimentTrendChart } from "@/components/sentiment-trend-chart";

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

  const reports = await listReportsForPatient(id);
  const sessions = reports.map((r) => ({ date: r.date, payload: r.payload, consultationId: r.consultationId }));
  const trend = sentimentTrend(sessions);
  const keywords = aggregateKeywords(sessions);
  const avg = averageSentiment(sessions);
  const maxWeight = Math.max(...keywords.map((k) => k.weight), 1);

  const delta =
    trend.length >= 2 ? trend[trend.length - 1].score - trend[0].score : 0;
  const DeltaIcon = delta > 0.05 ? TrendingUp : delta < -0.05 ? TrendingDown : Minus;
  const deltaColor = delta > 0.05 ? "text-mint" : delta < -0.05 ? "text-destructive" : "text-muted-foreground";

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

      {reports.length === 0 ? (
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
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-gray-line bg-card p-5">
              <p className="text-xs text-muted-foreground">Sesiones</p>
              <p className="font-heading text-2xl font-bold text-navy">{reports.length}</p>
            </div>
            <div className="rounded-2xl border border-gray-line bg-card p-5">
              <p className="text-xs text-muted-foreground">Sentimiento promedio</p>
              <p className="font-heading text-2xl font-bold text-navy">{avg.toFixed(2)}</p>
            </div>
            <div className="rounded-2xl border border-gray-line bg-card p-5">
              <p className="text-xs text-muted-foreground">Tendencia</p>
              <p className={`flex items-center gap-1.5 font-heading text-2xl font-bold ${deltaColor}`}>
                <DeltaIcon className="size-5" />
                {delta > 0 ? "+" : ""}
                {delta.toFixed(2)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-line bg-card p-6">
            <h2 className="mb-4 font-heading font-semibold text-navy">
              Evolución del sentimiento
            </h2>
            <SentimentTrendChart points={trend} />
            <div className="mt-2 flex justify-between px-4 text-xs text-muted-foreground">
              {trend.map((p, i) => (
                <span key={i}>{shortDate(p.date)}</span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-line bg-card p-6">
            <h2 className="mb-4 font-heading font-semibold text-navy">
              Temas recurrentes (todas las sesiones)
            </h2>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {keywords.map((k, i) => (
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
          </div>

          <div className="rounded-2xl border border-gray-line bg-card p-6">
            <h2 className="mb-3 font-heading font-semibold text-navy">Sesiones</h2>
            <ul className="divide-y divide-gray-line">
              {sessions.map((s) => (
                <li key={s.consultationId}>
                  <Link
                    href={`/consultations/${s.consultationId}`}
                    className="flex items-center justify-between py-2.5 text-sm hover:text-purple"
                  >
                    <span className="text-navy">{shortDate(s.date)}</span>
                    <span className="capitalize text-muted-foreground">
                      {s.payload.sentiment.label} ({s.payload.sentiment.score.toFixed(2)})
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
