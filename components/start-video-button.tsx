// components/start-video-button.tsx
"use client";

import { useTransition } from "react";
import { Video } from "lucide-react";
import { startVideoConsultationAction } from "@/app/(app)/appointments/actions";

export function StartVideoButton({ appointmentId }: { appointmentId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => startVideoConsultationAction(appointmentId))}
      disabled={pending}
      className="text-muted-foreground hover:text-purple disabled:opacity-50"
      aria-label="Iniciar videollamada"
      title="Iniciar videollamada"
    >
      <Video className="size-4" />
    </button>
  );
}
