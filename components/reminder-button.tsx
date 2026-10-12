"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Bell } from "lucide-react";
import { sendReminderAction } from "@/app/(app)/appointments/actions";

export function ReminderButton({ appointmentId }: { appointmentId: string }) {
  const [pending, startTransition] = useTransition();

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
      disabled={pending}
      className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-cloud hover:text-brand disabled:opacity-50"
      aria-label="Enviar recordatorio"
      title="Enviar recordatorio por correo"
    >
      <Bell className="size-4" />
    </button>
  );
}
