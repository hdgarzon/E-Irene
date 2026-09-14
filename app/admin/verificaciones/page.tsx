import { listVerifications, type PendingVerification } from "@/lib/db/verification";
import {
  LEGACY_VERIFICATION_DEADLINE,
  isAwaitingReview,
  legacyVerificationState,
} from "@/lib/verification";
import { formatLongDate } from "@/lib/dates";
import { AdminVerificationRow } from "@/components/admin-verification-row";

function legacyStateOf(v: PendingVerification) {
  return legacyVerificationState({
    status: v.status,
    notes: v.notes,
    hasIdDocument: Boolean(v.idDocumentPath),
    hasLicenseDocument: Boolean(v.licenseDocumentPath),
  });
}

export default async function AdminVerificacionesPage() {
  // Incluye 'verified' para poder suspender a alguien ya aprobado si llega el
  // reporte de una inhabilitación.
  const all = await listVerifications([
    "pending_review",
    "rejected",
    "suspended",
    "verified",
  ]);

  // Las cuentas heredadas que ya subieron documentos figuran como verificadas,
  // pero esperan la revisión retroactiva (migración 0043): son accionables.
  const needsDecision = (v: PendingVerification) =>
    isAwaitingReview(v.status) || legacyStateOf(v) === "awaiting_review";
  const pending = all.filter(needsDecision);
  const decided = all.filter((v) => !needsDecision(v));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Verificación profesional</h1>
        <p className="text-sm text-muted-foreground">
          Antes de aprobar, coteja la tarjeta profesional en la consulta pública de ReTHUS. Sin
          aprobación, la cuenta no puede crear pacientes ni transcribir consultas.
        </p>
      </div>

      <section className="rounded-2xl border border-gray-line bg-card p-6">
        <h2 className="mb-1 font-heading font-semibold text-navy">
          Por revisar ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay solicitudes pendientes.</p>
        ) : (
          <ul className="divide-y divide-gray-line">
            {pending.map((item) => (
              <AdminVerificationRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-gray-line bg-card p-6">
        <h2 className="mb-1 font-heading font-semibold text-navy">
          Cuentas revisadas ({decided.length})
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Incluye las cuentas anteriores a la verificación obligatoria que todavía no aportan
          documentos: tienen hasta el {formatLongDate(LEGACY_VERIFICATION_DEADLINE)}. Cuando los
          suben, pasan a Por revisar.
        </p>
        {decided.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay cuentas revisadas.</p>
        ) : (
          <ul className="divide-y divide-gray-line">
            {decided.map((item) => (
              <AdminVerificationRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
