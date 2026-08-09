import { listVerifications } from "@/lib/db/verification";
import { isAwaitingReview } from "@/lib/verification";
import { AdminVerificationRow } from "@/components/admin-verification-row";

export default async function AdminVerificacionesPage() {
  // Incluye 'verified' para poder suspender a alguien ya aprobado si llega el
  // reporte de una inhabilitación.
  const all = await listVerifications([
    "pending_review",
    "rejected",
    "suspended",
    "verified",
  ]);

  const pending = all.filter((v) => isAwaitingReview(v.status));
  const decided = all.filter((v) => !isAwaitingReview(v.status));

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
          Incluye las cuentas anteriores a la verificación obligatoria, aprobadas
          automáticamente en la migración y pendientes de revisión retroactiva.
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
