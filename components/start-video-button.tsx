"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Video } from "lucide-react";
import { startVideoConsultationAction } from "@/app/(app)/appointments/actions";

export function StartVideoButton({ appointmentId }: { appointmentId: string }) {
  const [pending, startTransition] = useTransition();

  function start() {
    startTransition(async () => {
      const res = await startVideoConsultationAction(appointmentId);
      if (res && !res.ok) toast.error(res.message);
    });
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={pending}
      className="text-muted-foreground hover:text-purple disabled:opacity-50"
      aria-label="Iniciar videollamada"
      title="Iniciar videollamada"
    >
      <Video className="size-4" />
    </button>
  );
}
