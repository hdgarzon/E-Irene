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

  function handleClick() {
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          setUrl(result.url);
          toast.success("Link generado y enviado al correo del paciente.");
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
        <p className="break-all rounded-lg bg-cloud px-3 py-2 text-xs text-muted-foreground">
          Enviado: {url}
        </p>
      )}
    </div>
  );
}
