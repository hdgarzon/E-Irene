"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MicOff, Square } from "lucide-react";
import { MOCK_SESSION } from "@/lib/providers/mock-transcript";
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

export function LiveConsultation({
  consultationId,
  patientName,
}: {
  consultationId: string;
  patientName: string;
}) {
  const [chunks, setChunks] = useState<{ speaker: string; text: string }[]>([]);
  const [done, setDone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
    }, 1400);

    return () => {
      clearInterval(streamer);
      clearInterval(clock);
    };
  }, [consultationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chunks]);

  function finalize() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
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
                Grabando · transcribiendo en vivo
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
