"use client";

import { useState } from "react";
import { VideoCall } from "@/components/video-call";

/**
 * Vista del paciente: solo la videollamada, sin panel de transcripción (esa
 * la lleva el doctor en /consultations/[id]/live — el paciente no necesita
 * ver ni recibir el texto). `onRemoteAudioTrack` es un no-op aquí: la pista
 * que le interesa capturar al PACIENTE es la del DOCTOR, pero esa transcripción
 * ya la genera el doctor con su propio mic local (ver Task 13) — duplicarla
 * desde este lado sería redundante.
 */
export function JoinCall({
  roomUrl,
  token,
  patientName,
}: {
  roomUrl: string;
  token: string;
  patientName: string;
}) {
  const [joined, setJoined] = useState(true);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="font-heading text-lg font-bold text-navy">Hola, {patientName}</h1>
        <p className="text-sm text-muted-foreground">Tu sesión está por comenzar.</p>
      </div>
      {joined && (
        <VideoCall
          roomUrl={roomUrl}
          token={token}
          userName={patientName}
          onRemoteAudioTrack={() => {}}
        />
      )}
      <p className="text-center text-xs text-muted-foreground">
        🔒 Esta llamada no se graba. Solo tu profesional ve la transcripción de la sesión.
      </p>
    </div>
  );
}
