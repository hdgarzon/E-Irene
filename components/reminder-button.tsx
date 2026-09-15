"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { sendReminderAction } from "@/app/(app)/appointments/actions";
import { useHydrated } from "@/lib/use-hydrated";

export function ReminderButton({ appointmentId }: { appointmentId: string }) {
  const [pending, startTransition] = useTransition();
  // Antes de hidratar, el clic no envía el recordatorio.
  const hydrated = useHydrated();

  function send() {
    startTransition(async () => {
      const res = await sendReminderAction(appointmentId);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={pending || !hydrated}
      className="text-muted-foreground hover:text-brand disabled:opacity-50"
      aria-label="Enviar recordatorio"
      title="Enviar recordatorio por correo"
    >
      <Bell className="size-4" />
    </button>
  );
}
