import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { getConsultation, getTranscript } from "@/lib/db/consultations";
import { getReportByConsultation } from "@/lib/db/reports";
import { getSoapNoteByConsultation } from "@/lib/db/soap-notes";
import { ReportView } from "@/components/report-view";
import { AnalysisStatusBanner } from "@/components/analysis-status";
import { SoapNoteEditor } from "@/components/soap-note-editor";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={`/patients/${consultation.patientId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver a la ficha del paciente
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">
            Consulta · {consultation.patientName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date(consultation.startedAt).toLocaleString("es-CO")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {report && (
            <a
              href={`/consultations/${id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Download className="size-4" />
              Descargar PDF
            </a>
          )}
          <Badge className="bg-mint/15 text-[#04342a]">Finalizada</Badge>
        </div>
      </div>

      {consultation.reason && (
        <div className="rounded-2xl border border-gray-line bg-card p-6">
          <h2 className="mb-2 font-heading font-semibold text-navy">Motivo de la consulta</h2>
          <p className="text-sm leading-relaxed text-foreground/90">{consultation.reason}</p>
        </div>
      )}

      {report ? (
        <ReportView report={report} consultationId={id} />
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

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <h2 className="mb-3 flex items-center gap-2 font-heading font-semibold text-navy">
          <FileText className="size-4 text-purple" />
          Transcripción
        </h2>
        {transcript ? (
          <div className="space-y-2 text-sm leading-relaxed">
            {transcript.split("\n").map((line, i) => {
              const [speaker, ...rest] = line.split(": ");
              return (
                <p key={i}>
                  <span className="font-medium text-purple">{speaker}:</span>{" "}
                  <span className="text-foreground/90">{rest.join(": ")}</span>
                </p>
              );
            })}
          </div>
        ) : consultation.endedAt &&
          Date.now() - new Date(consultation.endedAt).getTime() > 30 * 24 * 60 * 60 * 1000 ? (
          <p className="text-sm text-muted-foreground">
            Esta transcripción ya no está disponible: se elimina automáticamente 30 días después
            de terminada la consulta.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sin transcripción.</p>
        )}
      </div>
    </div>
  );
}
