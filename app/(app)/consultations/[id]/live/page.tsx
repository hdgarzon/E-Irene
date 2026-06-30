import { notFound, redirect } from "next/navigation";
import { getConsultation } from "@/lib/db/consultations";
import { getTranscriptionProvider } from "@/lib/providers";
import { LiveConsultation } from "@/components/live-consultation";

export default async function LiveConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  // Si ya terminó, no se puede volver a grabar.
  if (consultation.status !== "in_progress") redirect(`/consultations/${id}`);

  // El token efímero de Deepgram se acuña aquí (servidor); el navegador abre
  // el WebSocket directo con él. La API key real nunca llega al cliente.
  const provider = getTranscriptionProvider();
  const session = provider.mode === "deepgram" ? await provider.createSession(id) : null;

  return (
    <LiveConsultation
      consultationId={id}
      patientName={consultation.patientName}
      transcriptionMode={provider.mode === "deepgram" ? "deepgram" : "mock"}
      sessionToken={session?.sessionToken}
    />
  );
}
