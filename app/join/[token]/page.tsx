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
  const patientToken = isMock
    ? "mock-token"
    : await videoProvider.createMeetingToken({
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
