"use client";

import { useEffect, useRef, useState } from "react";
import Daily, { type DailyCall } from "@daily-co/daily-js";
import { MicOff } from "lucide-react";

/**
 * Embed de la videollamada (Daily.co). Renderiza el video local + remoto y,
 * vía `onRemoteAudioTrack`, entrega al padre la pista de audio del paciente
 * en crudo apenas está disponible — el padre (LiveConsultation) la usa para
 * alimentar una segunda conexión Deepgram tageada "Paciente" (ver spec §6:
 * sin esto no hay forma de transcribir lo que dice el paciente).
 */
export function VideoCall({
  roomUrl,
  token,
  userName,
  onRemoteAudioTrack,
}: {
  roomUrl: string;
  token: string;
  userName: string;
  onRemoteAudioTrack: (track: MediaStreamTrack) => void;
}) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const [joinError, setJoinError] = useState(false);

  useEffect(() => {
    const call = Daily.createCallObject();
    callRef.current = call;

    call.on("track-started", (ev) => {
      if (!ev) return;
      const { participant, track, type } = ev;
      if (type === "video") {
        const el = participant?.local ? localVideoRef.current : remoteVideoRef.current;
        if (el) el.srcObject = new MediaStream([track]);
      }
      if (type === "audio" && !participant?.local) {
        onRemoteAudioTrack(track);
      }
    });

    call.join({ url: roomUrl, token, userName }).catch(() => setJoinError(true));

    return () => {
      call.leave().catch(() => {});
      call.destroy();
      callRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se une una sola vez por montaje; roomUrl/token no cambian durante la llamada.
  }, []);

  if (joinError) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        <MicOff className="size-3.5" />
        No se pudo conectar la videollamada. Revisa tu conexión e intenta de nuevo.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 overflow-hidden rounded-2xl bg-navy">
      <video ref={localVideoRef} autoPlay playsInline muted className="aspect-video w-full rounded-xl object-cover" />
      <video ref={remoteVideoRef} autoPlay playsInline className="aspect-video w-full rounded-xl object-cover" />
    </div>
  );
}
