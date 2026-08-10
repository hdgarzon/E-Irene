import { CheckCircle2, TriangleAlert } from "lucide-react";
import { getChannelStatuses } from "@/lib/channel-status";

/**
 * Estado de los proveedores externos.
 *
 * Existe porque la ausencia de una credencial no produce ningún error: el
 * proveedor degrada a un modo simulado y la aplicación sigue como si nada.
 * Sin esta pantalla, la única forma de enterarse era leer el código o
 * descubrirlo cuando un paciente no recibía su enlace.
 */
export default async function AdminCanalesPage() {
  const channels = getChannelStatuses();
  const simulados = channels.filter((c) => c.mode === "simulated");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Estado de los canales</h1>
        <p className="text-sm text-muted-foreground">
          Un canal sin credenciales no falla: se simula. Esta pantalla existe para que eso no pase
          desapercibido.
        </p>
      </div>

      {simulados.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-medium text-amber-900">
              {simulados.length} {simulados.length === 1 ? "canal" : "canales"} en modo simulado
            </p>
            <p className="text-sm text-amber-900/80">
              Configura las variables que faltan y vuelve a desplegar para que tomen efecto.
            </p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-line bg-card">
        <ul className="divide-y divide-gray-line">
          {channels.map((c) => (
            <li key={c.key} className="flex flex-wrap items-start gap-3 p-5">
              {c.mode === "live" ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              ) : (
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-navy">{c.label}</p>
                {c.mode === "live" ? (
                  <p className="text-sm text-muted-foreground">Configurado y activo.</p>
                ) : (
                  <>
                    <p className="text-sm text-amber-900">{c.impact}</p>
                    {c.missing.length > 0 && (
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        Falta: {c.missing.join(", ")}
                      </p>
                    )}
                  </>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  c.mode === "live"
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {c.mode === "live" ? "Activo" : "Simulado"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
