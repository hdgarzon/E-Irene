import { notFound, redirect } from "next/navigation";
import { getConsultation } from "@/lib/db/consultations";
import { getAppointment } from "@/lib/db/appointments";
import { getTranscriptionProvider } from "@/lib/providers";
import { getVideoProvider } from "@/lib/video";
import { DailyVideoProvider } from "@/lib/video/daily";
import { requireUser } from "@/lib/auth";
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

  let videoRoomUrl: string | undefined;
  let videoToken: string | undefined;
  if (isVideo && appointment?.videoRoomName && appointment.videoRoomUrl) {
    const videoProvider = getVideoProvider();
    videoRoomUrl = appointment.videoRoomUrl;
    videoToken =
      videoProvider instanceof DailyVideoProvider
        ? await videoProvider.createMeetingToken({
            roomName: appointment.videoRoomName,
            userName: user.fullName,
            isOwner: true,
            expiresInSeconds: (appointment.durationMin + 30) * 60,
          })
        : "mock-token"; // MockVideoProvider: VideoCall renderiza sin conexión real.
  }

  return (
    <LiveConsultation
      consultationId={id}
      patientName={consultation.patientName}
      transcriptionMode={isVideo ? "video" : transcriptionProvider.mode === "deepgram" ? "deepgram" : "mock"}
      sessionToken={session?.sessionToken}
      videoRoomUrl={videoRoomUrl}
      videoToken={videoToken}
    />
  );
}
