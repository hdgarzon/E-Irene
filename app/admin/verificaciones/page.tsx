import { listVerificationQueue } from "@/lib/db/verification";
import { LEGACY_VERIFICATION_DEADLINE } from "@/lib/verification";
import { describeListPage, readListParams } from "@/lib/admin-list";
import { formatLongDate } from "@/lib/dates";
import { AdminVerificationRow } from "@/components/admin-verification-row";
import { AdminPagination, AdminSearchForm } from "@/components/admin-list-controls";

const PATH = "/admin/verificaciones";
/** La cola por revisar pagina con su propio parámetro; las revisadas usan ?page=. */
const PENDING_PAGE_KEY = "pendientes";

const NOUN = { singular: "cuenta", plural: "cuentas" };

export default async function AdminVerificacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { query, page: reviewedPage } = readListParams(params);
  const { page: pendingPage } = readListParams(params, PENDING_PAGE_KEY);
  // Lo accionable incluye las cuentas heredadas que ya subieron documentos:
  // figuran como verificadas, pero esperan la revisión retroactiva (migración
  // 0043). La separación ocurre en la BD (lib/verification.ts).
  const { pending, reviewed } = await listVerificationQueue({ query, pendingPage, reviewedPage });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Verificación profesional</h1>
        <p className="text-sm text-muted-foreground">
          Antes de aprobar, coteja la tarjeta profesional en la consulta pública de ReTHUS. Sin
          aprobación, la cuenta no puede crear pacientes ni transcribir consultas.
        </p>
      </div>

      <AdminSearchForm
        action={PATH}
        query={query}
        label="Buscar profesional"
        placeholder="Buscar por nombre o correo…"
      />

      <section className="space-y-3 rounded-2xl border border-gray-line bg-card p-6">
        <div>
          <h2 className="font-heading font-semibold text-navy">Por revisar ({pending.matched})</h2>
          <p data-testid="pending-summary" className="text-xs text-muted-foreground">
            {describeListPage(pending, NOUN)}. Las más antiguas primero.
          </p>
        </div>
        {pending.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query ? `Ninguna solicitud pendiente coincide con "${query}".` : "No hay solicitudes pendientes."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-line">
            {pending.items.map((item) => (
              <AdminVerificationRow key={item.id} item={item} />
            ))}
          </ul>
        )}
        <AdminPagination
          pathname={PATH}
          list={pending}
          pageKey={PENDING_PAGE_KEY}
          params={{ page: reviewed.page > 1 ? reviewed.page : undefined }}
        />
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-line bg-card p-6">
        <div>
          <h2 className="font-heading font-semibold text-navy">
            Cuentas revisadas ({reviewed.matched})
          </h2>
          <p data-testid="reviewed-summary" className="text-xs text-muted-foreground">
            {describeListPage(reviewed, NOUN)}. Las decididas más recientemente primero.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Incluye las cuentas anteriores a la verificación obligatoria que todavía no aportan
            documentos: tienen hasta el {formatLongDate(LEGACY_VERIFICATION_DEADLINE)}. Cuando los
            suben, pasan a Por revisar.
          </p>
        </div>
        {reviewed.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query ? `Ninguna cuenta revisada coincide con "${query}".` : "Aún no hay cuentas revisadas."}
          </p>
        ) : (
          <ul className="divide-y divide-gray-line">
            {reviewed.items.map((item) => (
              <AdminVerificationRow key={item.id} item={item} />
            ))}
          </ul>
        )}
        <AdminPagination
          pathname={PATH}
          list={reviewed}
          params={{ [PENDING_PAGE_KEY]: pending.page > 1 ? pending.page : undefined }}
        />
      </section>
    </div>
  );
}
