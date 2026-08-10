import { getAppointmentByJoinToken } from "@/lib/db/appointments";
import { isJoinWindowOpen } from "@/lib/video/join-token";
import { getVideoProvider } from "@/lib/video";
import { DailyVideoProvider } from "@/lib/video/daily";
import { JoinCall } from "./join-call";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const appointment = await getAppointmentByJoinToken(token);

  const invalid =
    !appointment ||
    appointment.modality !== "video" ||
    appointment.status === "cancelled" ||
    appointment.status === "completed" ||
    appointment.status === "no_show" ||
    !appointment.videoRoomUrl ||
    !isJoinWindowOpen({
      scheduledAt: appointment.scheduledAt,
      durationMin: appointment.durationMin,
    });

  if (invalid) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="font-heading text-xl font-bold text-navy">Enlace no válido</h1>
        <p className="text-sm text-muted-foreground">
          Este enlace ya no es válido o aún no es hora de tu cita. Contacta a tu clínica si
          necesitas ayuda.
        </p>
      </div>
    );
  }

  const videoProvider = getVideoProvider();
  const isMock = !(videoProvider instanceof DailyVideoProvider);

  // Sin proveedor de video configurado, la sala es falsa (mock.video) y la
  // llamada no puede establecerse. Antes se renderizaba igual y el paciente se
  // quedaba mirando una pantalla que nunca conecta, sin saber por qué.
  if (isMock) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="font-heading text-xl font-bold text-navy">
          La videollamada no está disponible
        </h1>
        <p className="text-sm text-muted-foreground">
          No podemos conectarte en este momento por una configuración pendiente de la plataforma.
          Comunícate con tu clínica para continuar tu cita por otro medio.
        </p>
      </div>
    );
  }

  const patientToken = await videoProvider.createMeetingToken({
    roomName: appointment!.videoRoomName!,
    userName: appointment!.patientName,
    isOwner: false,
    expiresInSeconds: (appointment!.durationMin + 30) * 60,
  });

  return (
    <JoinCall
      roomUrl={appointment!.videoRoomUrl!}
      token={patientToken}
      patientName={appointment!.patientName}
    />
  );
}
