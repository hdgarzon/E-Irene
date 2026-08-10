"use client";

import { useState, useTransition } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { GenerateLinkResult } from "@/app/(app)/patients/[id]/actions";

export function GeneratePatientLinkButton({
  action,
  label,
}: {
  action: () => Promise<GenerateLinkResult>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [delivered, setDelivered] = useState(true);

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setUrl(result.url);
          setDelivered(result.delivered);
          // Sin canal de correo configurado, el enlace existe pero no le llegó
          // a nadie. Decir "enviado" haría que el profesional no se lo pasara
          // al paciente por otro medio, creyendo que ya está.
          if (result.delivered) {
            toast.success("Link generado y enviado al correo del paciente.");
          } else {
            toast.warning("Link generado, pero el envío por correo no está activo. Cópialo y compártelo tú.");
          }
        } else {
          toast.error(result.error);
        }
      } catch {
        toast.error("Ocurrió un error inesperado. Intenta de nuevo.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
        {label}
      </Button>
      {url && (
        <p
          className={`break-all rounded-lg px-3 py-2 text-xs ${
            delivered
              ? "bg-cloud text-muted-foreground"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          {delivered ? "Enviado: " : "Compártelo tú (no se envió por correo): "}
          {url}
        </p>
      )}
    </div>
  );
}
