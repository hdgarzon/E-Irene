"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

/**
 * Error boundary para las rutas autenticadas. No muestra el detalle técnico al
 * usuario (podría contener datos sensibles); lo registra para diagnóstico.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("app.route_error", { digest: error.digest, error });
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <AlertTriangle className="size-10 text-destructive" />
      <h1 className="font-heading text-xl font-bold text-navy">Algo salió mal</h1>
      <p className="text-sm text-muted-foreground">
        No pudimos cargar esta sección. Intenta de nuevo; si el problema persiste, contacta al
        administrador de tu clínica.
      </p>
      <Button type="button" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
