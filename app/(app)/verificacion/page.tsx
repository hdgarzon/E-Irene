import { CheckCircle2, Clock, FileWarning, ShieldAlert, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getMyVerification } from "@/lib/db/verification";
import {
  VERIFICATION_DESCRIPTIONS,
  VERIFICATION_LABELS,
  canSubmitDocuments,
  roleRequiresVerification,
  type VerificationStatus,
} from "@/lib/verification";
import { VerificationForm } from "@/components/verification-form";
import { formatFullDate } from "@/lib/dates";

const ICONS: Record<VerificationStatus, typeof ShieldCheck> = {
  pending_documents: FileWarning,
  pending_review: Clock,
  verified: CheckCircle2,
  rejected: ShieldAlert,
  suspended: ShieldAlert,
};

const TONES: Record<VerificationStatus, string> = {
  pending_documents: "bg-amber-50 text-amber-900 border-amber-200",
  pending_review: "bg-blue-50 text-blue-900 border-blue-200",
  verified: "bg-emerald-50 text-emerald-900 border-emerald-200",
  rejected: "bg-red-50 text-red-900 border-red-200",
  suspended: "bg-red-50 text-red-900 border-red-200",
};

export default async function VerificacionPage() {
  const user = await requireUser();
  const verification = await getMyVerification(user.id);

  if (!verification) {
    return <p className="text-sm text-muted-foreground">No pudimos cargar tu verificación.</p>;
  }

  const { status } = verification;
  const Icon = ICONS[status];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Verificación profesional</h1>
        <p className="text-sm text-muted-foreground">
          Antes de atender pacientes verificamos que seas un profesional habilitado. Es lo que
          protege la historia clínica de quienes te consultan.
        </p>
      </div>

      <div className={`flex gap-3 rounded-2xl border p-5 ${TONES[status]}`}>
        <Icon className="mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">{VERIFICATION_LABELS[status]}</p>
          <p className="text-sm opacity-90">{VERIFICATION_DESCRIPTIONS[status]}</p>
          {status === "pending_review" && verification.submittedAt && (
            <p className="text-sm opacity-75">
              Enviado el {formatFullDate(verification.submittedAt)}.
            </p>
          )}
          {(status === "rejected" || status === "suspended") && verification.notes && (
            <p className="text-sm">
              <span className="font-medium">Motivo:</span> {verification.notes}
            </p>
          )}
        </div>
      </div>

      {!roleRequiresVerification(user.role) && (
        <div className="rounded-2xl border border-gray-line bg-card p-5 text-sm text-muted-foreground">
          Tu rol no requiere verificación propia. Para registrar pacientes, la clínica debe tener
          al menos un profesional verificado.
        </div>
      )}

      {status === "verified" && (
        <div className="rounded-2xl border border-gray-line bg-card p-5">
          <dl className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Profesión</dt>
              <dd className="font-medium text-navy">{verification.profession ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tarjeta profesional</dt>
              <dd className="font-medium text-navy">{verification.licenseNumber ?? "—"}</dd>
            </div>
            {verification.decidedAt && (
              <div>
                <dt className="text-muted-foreground">Verificado el</dt>
                <dd className="font-medium text-navy">
                  {formatFullDate(verification.decidedAt)}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {canSubmitDocuments(status) && roleRequiresVerification(user.role) && (
        <div className="rounded-2xl border border-gray-line bg-card p-6">
          <h2 className="mb-4 font-heading text-lg font-semibold text-navy">
            {status === "pending_documents" ? "Envía tus documentos" : "Vuelve a enviar tus documentos"}
          </h2>
          <VerificationForm
            clinicId={user.clinicId}
            userId={user.id}
            resubmit={status !== "pending_documents"}
          />
        </div>
      )}
    </div>
  );
}
