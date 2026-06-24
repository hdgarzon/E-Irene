import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getConsultation, getTranscript } from "@/lib/db/consultations";
import { Badge } from "@/components/ui/badge";

export default async function ConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  const transcript = await getTranscript(id);

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
        <Badge className="bg-mint/15 text-[#04342a]">Finalizada</Badge>
      </div>

      {/* El análisis con IA se inserta aquí en el Plan 5 */}

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
        ) : (
          <p className="text-sm text-muted-foreground">Sin transcripción.</p>
        )}
      </div>
    </div>
  );
}
