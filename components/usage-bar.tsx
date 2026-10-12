import { limitLabel } from "@/lib/plans";

/**
 * Barra de consumo "usado / límite" de los recursos del plan (pacientes,
 * profesionales, horas de transcripción). `max` Infinity = ilimitado: se
 * dibuja una barra fija corta en vez de un porcentaje.
 */
export function UsageBar({
  used,
  max,
  label,
  display,
}: {
  used: number;
  max: number;
  label: string;
  /** Texto del contador; por defecto "used / max" (para unidades, p. ej. horas). */
  display?: string;
}) {
  const pct = Number.isFinite(max) ? Math.min((used / max) * 100, 100) : Math.min(used, 100) / 4;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-navy">{display ?? `${used} / ${limitLabel(max)}`}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          // Llegar al tope no es un error: se marca en ámbar, no en rojo.
          className={`h-full rounded-full ${pct >= 100 ? "bg-warning" : "bg-brand"}`}
          style={{ width: `${Number.isFinite(max) ? pct : 25}%` }}
        />
      </div>
    </div>
  );
}
