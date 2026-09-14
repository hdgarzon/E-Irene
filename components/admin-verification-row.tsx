"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, ExternalLink, Ban, Undo2, X } from "lucide-react";
import {
  confirmLegacyVerificationAction,
  decideVerificationAction,
  getDocumentUrlAction,
  returnLegacyDocumentsAction,
  type ReviewState,
} from "@/app/admin/verificaciones/actions";
import type { PendingVerification } from "@/lib/db/verification";
import { VERIFICATION_LABELS, legacyVerificationState } from "@/lib/verification";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

const STATUS_TONE: Record<string, string> = {
  pending_review: "bg-blue-100 text-blue-900",
  rejected: "bg-red-100 text-red-900",
  suspended: "bg-red-100 text-red-900",
  verified: "bg-emerald-100 text-emerald-900",
};

/** Abre el documento en una pestaña nueva con una URL firmada de 5 minutos. */
function DocumentLink({ path, label }: { path: string | null; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!path) return <span className="text-xs text-muted-foreground">{label}: sin archivo</span>;

  function open() {
    setError(null);
    start(async () => {
      const url = await getDocumentUrlAction(path!);
      if (!url) {
        setError("No disponible");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={open}>
      <ExternalLink className="size-3.5" />
      {label}
      {error && <span className="ml-1 text-destructive">{error}</span>}
    </Button>
  );
}

export function AdminVerificationRow({ item }: { item: PendingVerification }) {
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(
    decideVerificationAction,
    {},
  );
  const [confirmState, confirmAction, confirmPending] = useActionState<ReviewState, FormData>(
    confirmLegacyVerificationAction,
    {},
  );
  const [returnState, returnAction, returnPending] = useActionState<ReviewState, FormData>(
    returnLegacyDocumentsAction,
    {},
  );
  // Devolver documentos heredados abre su propio campo de motivo.
  const [returning, setReturning] = useState(false);
  // Rechazar y suspender exigen motivo (lo pide decideVerificationAction), así
  // que ambos abren el mismo campo antes de poder confirmarse.
  const [mode, setMode] = useState<"reject" | "suspend" | null>(null);
  // Cuenta aprobada por el backfill de la 0032 sin revisar credenciales.
  const legacy = legacyVerificationState({
    status: item.status,
    role: item.role,
    notes: item.notes,
    hasIdDocument: Boolean(item.idDocumentPath),
    hasLicenseDocument: Boolean(item.licenseDocumentPath),
  });
  // Solo mientras la cuenta sigue esperando revisión: devueltos los documentos,
  // la fila cambia de estado y vuelven los demás botones.
  const returningDocuments = returning && legacy === "awaiting_review";

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-navy">{item.fullName}</p>
          <p className="text-xs text-muted-foreground">
            {item.email} · {item.clinicName}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {legacy === "awaiting_review" && (
            <Badge className="bg-blue-100 text-blue-900">Revisión retroactiva</Badge>
          )}
          {legacy === "needs_documents" && (
            <Badge className="bg-amber-100 text-amber-900">Heredada · sin documentos</Badge>
          )}
          <Badge className={STATUS_TONE[item.status] ?? "bg-muted text-foreground/70"}>
            {VERIFICATION_LABELS[item.status]}
          </Badge>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Profesión:</dt>
          <dd className="text-navy">{item.profession ?? "—"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Tarjeta:</dt>
          <dd className="text-navy">{item.licenseNumber ?? "—"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Cédula:</dt>
          <dd className="text-navy">{item.document ?? "—"}</dd>
        </div>
      </dl>

      <p className="text-xs text-muted-foreground">
        Coteja estos datos en la consulta pública de ReTHUS antes de aprobar.
      </p>

      <div className="flex flex-wrap gap-2">
        <DocumentLink path={item.idDocumentPath} label="Ver cédula" />
        <DocumentLink path={item.licenseDocumentPath} label="Ver tarjeta profesional" />
      </div>

      {item.notes && item.status !== "pending_review" && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium">Nota anterior:</span> {item.notes}
        </p>
      )}

      {legacy === "awaiting_review" && !mode && !returningDocuments && (
        <form action={confirmAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={item.id} />
          <Button type="submit" size="sm" disabled={confirmPending}>
            <Check className="size-3.5" /> Confirmar habilitación
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setReturning(true)}>
            <Undo2 className="size-3.5" /> Devolver documentos
          </Button>
          <span className="text-xs text-muted-foreground">
            Si los documentos no sirven, devuélvelos para que los suba de nuevo. Suspende solo si
            hay un problema con la habilitación.
          </span>
          {confirmState.error && (
            <span className="text-xs text-destructive">{confirmState.error}</span>
          )}
          {confirmState.success && (
            <span className="text-xs text-emerald-700">{confirmState.success}</span>
          )}
        </form>
      )}

      {returningDocuments && (
        <form action={returnAction} className="space-y-2">
          <input type="hidden" name="userId" value={item.id} />
          <Textarea
            name="reason"
            required
            rows={2}
            placeholder="Qué debe corregir — el profesional lo verá en su pantalla"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="outline" disabled={returnPending}>
              Confirmar devolución
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setReturning(false)}>
              Cancelar
            </Button>
            {returnState.error && (
              <span className="text-xs text-destructive">{returnState.error}</span>
            )}
          </div>
        </form>
      )}

      {returnState.success && !returningDocuments && (
        <p className="text-xs text-emerald-700">{returnState.success}</p>
      )}

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="userId" value={item.id} />

        {mode && (
          <Textarea
            name="notes"
            required
            rows={2}
            placeholder={
              mode === "reject"
                ? "Motivo del rechazo — el profesional lo verá en su pantalla"
                : "Motivo de la suspensión — el profesional lo verá en su pantalla"
            }
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {item.status === "pending_review" && !mode && (
            <>
              <Button type="submit" name="decision" value="verified" size="sm" disabled={pending}>
                <Check className="size-3.5" /> Aprobar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={() => setMode("reject")}
              >
                <X className="size-3.5" /> Rechazar
              </Button>
            </>
          )}

          {item.status === "verified" && !mode && !returningDocuments && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setMode("suspend")}
            >
              <Ban className="size-3.5" /> Suspender
            </Button>
          )}

          {mode && (
            <>
              <Button
                type="submit"
                name="decision"
                value={mode === "reject" ? "rejected" : "suspended"}
                size="sm"
                variant="destructive"
                disabled={pending}
              >
                {mode === "reject" ? "Confirmar rechazo" : "Confirmar suspensión"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>
                Cancelar
              </Button>
            </>
          )}

          {state.error && <span className="text-xs text-destructive">{state.error}</span>}
          {state.success && <span className="text-xs text-emerald-700">{state.success}</span>}
        </div>
      </form>
    </li>
  );
}
