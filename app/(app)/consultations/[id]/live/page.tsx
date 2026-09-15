import { notFound, redirect } from "next/navigation";
import { getConsultation } from "@/lib/db/consultations";
import { getAppointment } from "@/lib/db/appointments";
import { beginTranscriptionSession } from "@/lib/db/transcription-usage";
import { getTranscriptionProvider } from "@/lib/providers";
import { getVideoProvider } from "@/lib/video";
import { DailyVideoProvider } from "@/lib/video/daily";
import { doctorVideoUserId } from "@/lib/video/participant-id";
import { ensureConsultationVideoAccess } from "@/lib/billing/video-access";
import { getClinicSubscription } from "@/lib/db/clinic";
import { requireVerifiedProfessional } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { LiveConsultation } from "@/components/live-consultation";

export default async function LiveConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Antes de acuñar el token de Deepgram: sin verificación no se transcribe.
  const user = await requireVerifiedProfessional();
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  // Si ya terminó, no se puede volver a grabar.
  if (consultation.status !== "in_progress") redirect(`/consultations/${id}`);

  const appointment = consultation.appointmentId
    ? await getAppointment(consultation.appointmentId)
    : null;
  const isVideo = appointment?.modality === "video";

  // Cuota mensual de transcripción del plan (lib/plans.ts + migración 0039):
  // se verifica ANTES de acuñar cualquier token. beginTranscriptionSession
  // además abre el registro de consumo (idempotente por consulta: recargar la
  // página no duplica horas; el modo video tampoco — sus 2 conexiones Deepgram
  // cuentan la duración de la consulta UNA sola vez). Con la cuota agotada no
  // se crea sesión de ningún proveedor (mock incluido) y la UI lo explica.
  const quota = await beginTranscriptionSession(id, user.clinicId);

  // El token efímero de Deepgram se acuña aquí (servidor); el navegador abre
  // el WebSocket directo con él. La API key real nunca llega al cliente.
  // En modo video se necesita igual (transcribe el mic local del doctor).
  const transcriptionProvider = getTranscriptionProvider();
  const needsDeepgramSession = transcriptionProvider.mode === "deepgram" || isVideo;
  const session =
    quota.allowed && needsDeepgramSession
      ? await transcriptionProvider.createSession(id)
      : null;

  // Si Daily.co falla al acuñar el token (red caída, key inválida), no debe
  // tumbar toda la página — el doctor debe poder seguir con la transcripción
  // de texto aunque el video no esté disponible. Por eso videoRoomUrl solo se
  // setea DESPUÉS de que createMeetingToken resuelve con éxito, y transcriptionMode
  // se deriva de si el video realmente quedó listo, no solo de la modalidad.
  // Videollamadas por plan (migración 0058): el token del profesional solo se emite
  // con un plan que las incluye o con la reserva de esta consulta. Sin token, la
  // consulta sigue en modo texto y se explica por qué.
  let videoBlocked: "plan" | "credits" | "unavailable" | null = null;
  if (isVideo && appointment) {
    try {
      const { plan } = await getClinicSubscription();
      const access = await ensureConsultationVideoAccess({
        plan,
        appointmentId: appointment.id,
        consultationId: id,
      });
      if (!access.allowed) videoBlocked = access.reason;
    } catch (error) {
      videoBlocked = "unavailable";
      logger.error("video.access_check_failed", {
        clinicId: user.clinicId,
        actorId: user.id,
        consultationId: id,
        error,
      });
    }
  }

  let videoRoomUrl: string | undefined;
  let videoToken: string | undefined;
  if (isVideo && !videoBlocked && appointment?.videoRoomName && appointment.videoRoomUrl) {
    try {
      const videoProvider = getVideoProvider();
      videoToken =
        videoProvider instanceof DailyVideoProvider
          ? await videoProvider.createMeetingToken({
              roomName: appointment.videoRoomName,
              userName: user.fullName,
              isOwner: true,
              userId: doctorVideoUserId(user.id),
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
    <>
      {videoBlocked && (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-foreground/90"
        >
          {videoBlocked === "plan"
            ? "Tu plan no incluye videollamadas: esta consulta sigue sin video."
            : videoBlocked === "credits"
              ? "No hay videollamadas disponibles: esta consulta sigue sin video. Puedes comprar un pack en Plan y facturación."
              : "No se pudo verificar el saldo de videollamadas: esta consulta sigue sin video. Recarga la página para intentarlo de nuevo."}
        </div>
      )}
      <LiveConsultation
      consultationId={id}
      patientName={consultation.patientName}
      transcriptionMode={videoReady ? "video" : transcriptionProvider.mode === "deepgram" ? "deepgram" : "mock"}
      // Sin DEEPGRAM_API_KEY, session.sessionToken es un token falso: en modo
      // video, LiveConsultation lo necesita para decidir si abre un WebSocket
      // real a Deepgram o transmite el guion simulado (ver su propio
      // comentario) — de lo contrario cualquier consulta de video sin
      // Deepgram configurado se queda sin transcripción, en silencio.
      transcriptionIsSimulated={transcriptionProvider.mode !== "deepgram"}
      sessionToken={session?.sessionToken}
      videoRoomUrl={videoRoomUrl}
      videoToken={videoToken}
      quotaExceeded={!quota.allowed}
      canManagePlan={user.role === "admin"}
      />
    </>
  );
}
