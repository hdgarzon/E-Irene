import { notFound, redirect } from "next/navigation";
import { getConsultation } from "@/lib/db/consultations";
import { getAppointment } from "@/lib/db/appointments";
import { getTranscriptionProvider } from "@/lib/providers";
import { getVideoProvider } from "@/lib/video";
import { DailyVideoProvider } from "@/lib/video/daily";
import { requireUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { LiveConsultation } from "@/components/live-consultation";

export default async function LiveConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  // Si ya terminó, no se puede volver a grabar.
  if (consultation.status !== "in_progress") redirect(`/consultations/${id}`);

  const appointment = consultation.appointmentId
    ? await getAppointment(consultation.appointmentId)
    : null;
  const isVideo = appointment?.modality === "video";

  // El token efímero de Deepgram se acuña aquí (servidor); el navegador abre
  // el WebSocket directo con él. La API key real nunca llega al cliente.
  // En modo video se necesita igual (transcribe el mic local del doctor).
  const transcriptionProvider = getTranscriptionProvider();
  const needsDeepgramSession = transcriptionProvider.mode === "deepgram" || isVideo;
  const session = needsDeepgramSession
    ? await transcriptionProvider.createSession(id)
    : null;

  // Si Daily.co falla al acuñar el token (red caída, key inválida), no debe
  // tumbar toda la página — el doctor debe poder seguir con la transcripción
  // de texto aunque el video no esté disponible. Por eso videoRoomUrl solo se
  // setea DESPUÉS de que createMeetingToken resuelve con éxito, y transcriptionMode
  // se deriva de si el video realmente quedó listo, no solo de la modalidad.
  let videoRoomUrl: string | undefined;
  let videoToken: string | undefined;
  if (isVideo && appointment?.videoRoomName && appointment.videoRoomUrl) {
    try {
      const videoProvider = getVideoProvider();
      videoToken =
        videoProvider instanceof DailyVideoProvider
          ? await videoProvider.createMeetingToken({
              roomName: appointment.videoRoomName,
              userName: user.fullName,
              isOwner: true,
              expiresInSeconds: (appointment.durationMin + 30) * 60,
            })
          : "mock-token"; // MockVideoProvider: VideoCall renderiza sin conexión real.
      videoRoomUrl = appointment.videoRoomUrl;
    } catch (error) {
      logger.error("video.meeting_token_failed", {
        clinicId: user.clinicId,
        actorId: user.id,
        appointmentId: appointment.id,
        error,
      });
    }
  }
  const videoReady = Boolean(videoRoomUrl && videoToken);

  return (
    <LiveConsultation
      consultationId={id}
      patientName={consultation.patientName}
      transcriptionMode={videoReady ? "video" : transcriptionProvider.mode === "deepgram" ? "deepgram" : "mock"}
      sessionToken={session?.sessionToken}
      videoRoomUrl={videoRoomUrl}
      videoToken={videoToken}
    />
  );
}
