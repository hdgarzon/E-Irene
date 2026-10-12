"use client";

import { useState } from "react";
import { Video } from "lucide-react";
import { VideoCall } from "@/components/video-call";
import { Button } from "@/components/ui/button";

/**
 * Vista del paciente: solo la videollamada, sin panel de transcripción (esa
 * la lleva el doctor en /consultations/[id]/live — el paciente no necesita
 * ver ni recibir el texto). `onRemoteAudioTrack` es un no-op aquí: la pista
 * que le interesa capturar al PACIENTE es la del DOCTOR, pero esa transcripción
 * ya la genera el doctor con su propio mic local (ver Task 13) — duplicarla
 * desde este lado sería redundante.
 *
 * El paciente entra solo cuando lo pide. VideoCall llama a `call.join()` al
 * montarse, así que renderizarlo de entrada encendía su cámara y su micrófono
 * con solo abrir el enlace. El doctor llega acá tras pulsar "iniciar
 * videollamada"; el paciente, en cambio, abre un enlace que le llegó por
 * correo o WhatsApp — puede estar comprobando la hora, en el transporte o
 * acompañado. Abrir un enlace no es consentir aparecer en cámara.
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
  const [joined, setJoined] = useState(false);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="font-heading text-lg font-bold text-navy">Hola, {patientName}</h1>
        <p className="text-sm text-muted-foreground">
          {joined ? "Tu sesión está por comenzar." : "Tu profesional te está esperando."}
        </p>
      </div>

      {joined ? (
        <VideoCall
          roomUrl={roomUrl}
          token={token}
          userName={patientName}
          onRemoteAudioTrack={() => {}}
        />
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-line bg-card p-8 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-cloud">
            <Video className="size-7 text-brand" />
          </span>
          <p className="text-sm text-muted-foreground">
            Al entrar se activarán tu cámara y tu micrófono. Puedes apagarlos en cualquier
            momento durante la llamada.
          </p>
          <Button size="lg" onClick={() => setJoined(true)}>
            <Video className="size-4" />
            Entrar a la videollamada
          </Button>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        🔒 Esta llamada no se graba. Solo tu profesional ve la transcripción de la sesión.
      </p>
    </div>
  );
}
