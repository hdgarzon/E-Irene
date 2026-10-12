import { notFound } from "next/navigation";
import { Download, FileText, MessageSquareText } from "lucide-react";
import { getConsultation, getTranscript } from "@/lib/db/consultations";
import { getReportByConsultation } from "@/lib/db/reports";
import { getSoapNoteByConsultation } from "@/lib/db/soap-notes";
import { isMoreThanDaysAgo } from "@/lib/dates";
import {
  ReportBody,
  ReportDisclaimer,
  ReportValidation,
  RiskAlerts,
} from "@/components/report-view";
import { AnalysisStatusBanner } from "@/components/analysis-status";
import { SoapNoteEditor } from "@/components/soap-note-editor";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  const [transcript, report, soapNote] = await Promise.all([
    getTranscript(id),
    getReportByConsultation(id),
    getSoapNoteByConsultation(id),
  ]);
  const transcriptPurged = Boolean(
    consultation.endedAt && isMoreThanDaysAgo(consultation.endedAt, 30),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        back={{ href: `/patients/${consultation.patientId}`, label: "Volver a la ficha del paciente" }}
        title={<>Consulta · {consultation.patientName}</>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {new Date(consultation.startedAt).toLocaleString("es-CO")}
            <StatusBadge tone="success" dot>
              Finalizada
            </StatusBadge>
          </span>
        }
        actions={
          report && (
            <a
              href={`/consultations/${id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <Download className="size-4" />
              Descargar PDF
            </a>
          )
        }
      />

      {/* Dos columnas en escritorio: el contenido clínico a la izquierda y, a la
          derecha, lo que el profesional debe ver y decidir (riesgo y firma). En
          móvil el riesgo va primero y la firma al final, después de leer. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_auto_1fr] lg:items-start">
        {report && (
          <div className="lg:col-start-2 lg:row-start-1">
            <RiskAlerts riskFlags={report.payload.riskFlags} />
          </div>
        )}

        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-span-3 lg:row-start-1">
          {consultation.reason && (
            <section className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-navy">
                <MessageSquareText className="size-4 text-brand" />
                Motivo de la consulta
              </h2>
              <p className="text-[0.9375rem] leading-relaxed text-foreground/90">{consultation.reason}</p>
            </section>
          )}

          {report ? (
            <>
              <ReportDisclaimer />
              <ReportBody report={report} consultationId={id} />
            </>
          ) : (
            consultation.analysisStatus && (
              <AnalysisStatusBanner
                consultationId={id}
                status={consultation.analysisStatus}
                error={consultation.analysisError}
              />
            )
          )}

          <SoapNoteEditor consultationId={id} patientId={consultation.patientId} note={soapNote} />

          <section className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
            <h2 className="mb-4 flex items-center gap-2 font-semibold text-navy">
              <FileText className="size-4 text-brand" />
              Transcripción
            </h2>
            {transcript ? (
              <div className="space-y-3 text-sm leading-relaxed">
                {transcript.split("\n").map((line, i) => {
                  const [speaker, ...rest] = line.split(": ");
                  return (
                    <p key={i} className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3">
                      <span className="text-xs font-semibold tracking-wide text-brand uppercase sm:pt-0.5 sm:text-right">
                        {speaker}:
                      </span>{" "}
                      <span className="text-foreground/90">{rest.join(": ")}</span>
                    </p>
                  );
                })}
              </div>
            ) : transcriptPurged ? (
              <p className="text-sm text-muted-foreground">
                Esta transcripción ya no está disponible: se elimina automáticamente 7 días después
                de la sesión.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Sin transcripción.</p>
            )}
          </section>
        </div>

        {report && (
          <div className="lg:sticky lg:top-20 lg:col-start-2 lg:row-start-2">
            <ReportValidation report={report} consultationId={id} />
          </div>
        )}
      </div>
    </div>
  );
}
