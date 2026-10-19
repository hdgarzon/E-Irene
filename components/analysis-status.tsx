"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertTriangle, RotateCw } from "lucide-react";
import { retryAnalysisAction } from "@/app/(app)/consultations/actions";
import type { AnalysisStatus } from "@/lib/db/consultations";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";

const POLL_MS = 3000;

/** Estado del análisis de IA en background: progreso (con polling) o error con reintento. */
export function AnalysisStatusBanner({
  consultationId,
  status,
  error,
}: {
  consultationId: string;
  status: AnalysisStatus;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Antes de hidratar, reintentar no llega al servidor.
  const hydrated = useHydrated();
  const inProgress = status === "pending" || status === "processing";

  useEffect(() => {
    if (!inProgress) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [inProgress, router]);

  if (inProgress) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-gray-line bg-card p-5">
        <Loader2 className="size-5 shrink-0 animate-spin text-brand" />
        <div className="text-sm">
          <p className="font-medium text-navy">Analizando la sesión con IA…</p>
          <p className="text-muted-foreground">
            El reporte aparecerá aquí automáticamente en unos segundos.
          </p>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="space-y-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-2 text-sm">
            <p className="font-medium text-destructive">
              No se pudo generar el reporte ni evaluar el riesgo
            </p>
            <p className="text-muted-foreground">
              {error ?? "Ocurrió un error al analizar la transcripción."}
            </p>
            {/* La detección de riesgo (ideación suicida, autolesión, consumo,
                riesgo a terceros) sale del mismo análisis que acaba de fallar.
                Decir solo "no se pudo generar el reporte" se lee como "te
                quedaste sin el resumen", y deja al profesional creyendo que, de
                haber algo grave, el sistema le habría avisado. No lo evaluó. */}
            <p className="font-medium text-foreground/90">
              Esta sesión no fue revisada por el sistema: que no aparezcan alertas acá no
              significa que no haya riesgo. Revisa la transcripción con tu propio criterio.
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !hydrated}
          onClick={() => startTransition(() => retryAnalysisAction(consultationId))}
        >
          <RotateCw className="size-3.5" />
          {pending ? "Reintentando…" : "Reintentar análisis"}
        </Button>
      </div>
    );
  }

  return null;
}
