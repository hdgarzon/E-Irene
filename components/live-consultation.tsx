"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MicOff, Square } from "lucide-react";
import { MOCK_SESSION } from "@/lib/providers/mock-transcript";
// Imports directos a los módulos (no al barrel @/lib/providers, que re-exporta
// mock.ts → node:crypto, incompatible con el bundle del cliente).
import { DEEPGRAM_LISTEN_URL } from "@/lib/providers/deepgram";
import { majoritySpeaker, labelForSpeaker, type DiarizedWord } from "@/lib/diarization";
import {
  appendChunkAction,
  endConsultationAction,
} from "@/app/(app)/consultations/actions";
import { Button } from "@/components/ui/button";

function mmss(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface DeepgramResult {
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string; words?: DiarizedWord[] }[] };
}

export function LiveConsultation({
  consultationId,
  patientName,
  transcriptionMode,
  sessionToken,
}: {
  consultationId: string;
  patientName: string;
  /** "deepgram" usa streaming real navegador→Deepgram; "mock" reproduce un guion de demo. */
  transcriptionMode: "mock" | "deepgram";
  sessionToken?: string;
}) {
  const [chunks, setChunks] = useState<{ speaker: string; text: string }[]>([]);
  const [done, setDone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const seqRef = useRef(0);
  const speakerLabelsRef = useRef<Map<number, string>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Modo mock: guion simulado (sin micrófono real necesario) ──
  useEffect(() => {
    if (transcriptionMode !== "mock") return;

    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      md.getUserMedia({ audio: true })
        .then((stream) => {
          streamRef.current = stream;
          setMicOk(true);
        })
        .catch(() => setMicOk(false));
    } else {
      setMicOk(false);
    }

    const clock = setInterval(() => setElapsed((e) => e + 1), 1000);

    let i = 0;
    const streamer = setInterval(() => {
      if (i >= MOCK_SESSION.length) {
        clearInterval(streamer);
        setDone(true);
        return;
      }
      const line = MOCK_SESSION[i];
      const seq = i;
      i += 1;
      setChunks((prev) => [...prev, line]);
      void appendChunkAction(consultationId, { seq, speaker: line.speaker, text: line.text }).catch(
        () => {},
      );
    }, 700);

    return () => {
      clearInterval(streamer);
      clearInterval(clock);
    };
  }, [transcriptionMode, consultationId]);

  // ── Modo real: micrófono → MediaRecorder → WebSocket directo a Deepgram ──
  useEffect(() => {
    if (transcriptionMode !== "deepgram" || !sessionToken) return;

    const clock = setInterval(() => setElapsed((e) => e + 1), 1000);
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setMicOk(true);

        const ws = new WebSocket(DEEPGRAM_LISTEN_URL, ["token", sessionToken!]);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          try {
            const data: DeepgramResult = JSON.parse(event.data as string);
            const alt = data.channel?.alternatives?.[0];
            const text = alt?.transcript?.trim();
            if (data.is_final && text) {
              const speakerIndex = majoritySpeaker(alt?.words ?? []);
              const speaker =
                speakerIndex !== undefined
                  ? labelForSpeaker(speakerIndex, speakerLabelsRef.current)
                  : "Transcripción";
              const seq = seqRef.current++;
              setChunks((prev) => [...prev, { speaker, text }]);
              void appendChunkAction(consultationId, { seq, speaker, text }).catch(() => {});
            }
          } catch {
            // mensaje no-JSON (p.ej. control frames); se ignora.
          }
        };

        ws.onopen = () => {
          const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
          recorderRef.current = recorder;
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
          };
          recorder.start(250);
        };
      } catch {
        setMicOk(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      clearInterval(clock);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [transcriptionMode, sessionToken, consultationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chunks]);

  function finalize() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "CloseStream" }));
      wsRef.current.close();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setDone(true);
    startTransition(() => endConsultationAction(consultationId));
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-7rem)] max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between rounded-2xl border border-gray-line bg-card px-5 py-4">
        <div>
          <p className="font-heading font-semibold text-navy">{patientName}</p>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {done ? (
              <span className="text-mint">Transcripción finalizada</span>
            ) : (
              <>
                <span className="inline-block size-2 animate-pulse rounded-full bg-destructive" />
                {transcriptionMode === "deepgram"
                  ? "Grabando · identificando Doctor y Paciente"
                  : "Grabando · transcribiendo en vivo"}
              </>
            )}
          </p>
        </div>
        <span className="font-mono text-lg font-semibold text-navy">{mmss(elapsed)}</span>
      </div>

      {micOk === false && (
        <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <MicOff className="size-3.5" />
          Sin acceso al micrófono — la sesión continúa en modo demostración.
        </p>
      )}

      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-gray-line bg-card p-5"
      >
        {chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Escuchando…</p>
        ) : (
          chunks.map((c, idx) => (
            <div key={idx} className={c.speaker === "Doctor" ? "" : "flex flex-col items-end"}>
              <span className="text-xs font-medium text-muted-foreground">{c.speaker}</span>
              <p
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                  c.speaker === "Doctor"
                    ? "bg-cloud text-navy"
                    : "bg-purple/10 text-navy"
                }`}
              >
                {c.text}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-line bg-card px-5 py-4">
        <p className="text-xs text-muted-foreground">🔒 El audio no se almacena. Solo el texto, cifrado.</p>
        <Button onClick={finalize} disabled={pending} variant="default">
          <Square className="size-4" />
          {pending ? "Generando reporte…" : "Finalizar consulta"}
        </Button>
      </div>
    </div>
  );
}
