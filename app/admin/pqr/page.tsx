import { listPqrs } from "@/lib/db/pqr";
import { PQR_KIND_LABEL, PQR_STATUSES, PQR_STATUS_LABEL, pqrDueDate } from "@/lib/pqr";
import { describeListPage, readListParams } from "@/lib/admin-list";
import { dayKey, formatLongDate, formatTime } from "@/lib/dates";
import { AdminPagination, AdminSearchForm } from "@/components/admin-list-controls";
import { Button } from "@/components/ui/button";
import { setPqrStatusAction } from "./actions";

const PATH = "/admin/pqr";

export default async function AdminPqrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pqrs = await listPqrs(readListParams(await searchParams));
  const today = dayKey(new Date());

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">PQR</h1>
        <p data-testid="list-summary" className="text-sm text-muted-foreground">
          Peticiones, quejas y reclamos del sitio —{" "}
          {describeListPage(pqrs, { singular: "solicitud", plural: "solicitudes" })}. Plazo de
          respuesta: 15 días hábiles desde la radicación.
        </p>
      </div>

      <AdminSearchForm
        action={PATH}
        query={pqrs.query}
        label="Buscar PQR por radicado o correo"
        placeholder="Radicado o correo…"
      />

      <div className="space-y-4">
        {pqrs.items.length === 0 ? (
          <p className="rounded-2xl border border-gray-line bg-card p-6 text-sm text-muted-foreground">
            {pqrs.query ? `Ninguna PQR coincide con "${pqrs.query}".` : "Aún no hay PQR radicadas."}
          </p>
        ) : (
          pqrs.items.map((p) => {
            const due = pqrDueDate(p.createdAt);
            const open = p.status !== "respondida";
            const overdue = open && due < today;
            return (
              <article key={p.id} className="space-y-3 rounded-2xl border border-gray-line bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-navy">{p.radicado}</p>
                    <p className="text-xs text-muted-foreground">
                      {PQR_KIND_LABEL[p.kind]} · {formatLongDate(p.createdAt)}, {formatTime(p.createdAt)}
                    </p>
                  </div>
                  <p className={`text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                    {open
                      ? `${overdue ? "Vencida: " : "Responder antes del "}${formatLongDate(`${due}T12:00:00-05:00`)}`
                      : `Respondida el ${formatLongDate(p.respondedAt ?? p.createdAt)}`}
                  </p>
                </div>
                <p className="text-sm">
                  {p.fullName} · <a href={`mailto:${p.email}?subject=${encodeURIComponent(`Respuesta a su PQR ${p.radicado}`)}`} className="text-primary hover:underline">{p.email}</a>
                  {p.phone ? ` · ${p.phone}` : ""}
                </p>
                <p className="whitespace-pre-wrap rounded-lg bg-cloud p-3 text-sm">{p.message}</p>
                <form action={setPqrStatusAction.bind(null, p.id)} className="flex items-center gap-2">
                  <label htmlFor={`status-${p.id}`} className="text-xs text-muted-foreground">
                    Estado
                  </label>
                  <select
                    id={`status-${p.id}`}
                    name="status"
                    defaultValue={p.status}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                  >
                    {PQR_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PQR_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    Guardar
                  </Button>
                </form>
              </article>
            );
          })
        )}
      </div>

      <AdminPagination pathname={PATH} list={pqrs} />
    </div>
  );
}
