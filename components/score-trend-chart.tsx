import { severityFor, type AssessmentType } from "@/lib/psychometrics";

/** Fondos de las bandas de severidad, de la más leve a la más alta. */
const BAND_FILL = ["#f4f8fc", "#eef4fb", "#fffaeb", "#fef3f2", "#fde8e6"];

/**
 * Tramos contiguos de severidad en 0..max, leídos de `severityFor` para no
 * duplicar los umbrales clínicos aquí.
 */
function severityBands(type: AssessmentType, max: number) {
  const bands: { label: string; from: number; to: number }[] = [];
  for (let score = 0; score <= max; score++) {
    const label = severityFor(type, score);
    const last = bands[bands.length - 1];
    if (last && last.label === label) last.to = score;
    else bands.push({ label, from: score, to: score });
  }
  return bands;
}

/**
 * Gráfico de línea para una métrica en escala 0..max entre aplicaciones.
 *
 * Altura fija y textos en HTML: con un viewBox escalado al ancho, las
 * etiquetas salían enormes en escritorio y diminutas en móvil. El SVG solo
 * dibuja bandas y línea (con trazo que no se deforma); puntos y textos se
 * posicionan en porcentaje sobre él.
 */
export function ScoreTrendChart({
  points,
  max,
  type,
  color = "#0d5ab0",
}: {
  points: { date: string; score: number }[];
  max: number;
  /** Si se indica, se dibujan las bandas de severidad de la escala. */
  type?: AssessmentType;
  color?: string;
}) {
  const n = points.length;
  // Márgenes en % para que el primer y el último punto no queden cortados.
  const x = (i: number) => (n === 1 ? 50 : 4 + (i / (n - 1)) * 92);
  const y = (score: number) => (1 - score / max) * 100;
  const bands = type ? severityBands(type, max) : [];
  const line = points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ");

  return (
    <div
      role="img"
      aria-label={`Evolución del puntaje: ${points.map((p) => p.score).join(", ")} de ${max}`}
      className="flex gap-2"
    >
      <div className="relative w-6 shrink-0 text-[11px] tabular-nums text-muted-foreground">
        <span className="absolute top-0 right-0 -translate-y-1/2">{max}</span>
        <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
      </div>
      <div className="relative h-44 flex-1 overflow-visible rounded-lg border border-gray-line">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-hidden rounded-lg"
          aria-hidden
        >
          {bands.map((b, i) => {
            // Cada banda cubre de su primer puntaje al primero de la siguiente.
            const top = y(i === bands.length - 1 ? max : bands[i + 1].from);
            const bottom = y(b.from);
            return (
              <rect
                key={b.label}
                x="0"
                y={top}
                width="100"
                height={bottom - top}
                fill={BAND_FILL[Math.min(i, BAND_FILL.length - 1)]}
              />
            );
          })}
          {n > 1 && (
            <polyline
              points={line}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {bands.map((b, i) => {
          const top = y(i === bands.length - 1 ? max : bands[i + 1].from);
          const bottom = y(b.from);
          return (
            <span
              key={b.label}
              aria-hidden
              className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-muted-foreground"
              style={{ top: `${(top + bottom) / 2}%` }}
            >
              {b.label}
            </span>
          );
        })}
        {points.map((p, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute size-3 -translate-1/2 rounded-full border-2 border-white shadow-sm"
            style={{ left: `${x(i)}%`, top: `${y(p.score)}%`, backgroundColor: color }}
          />
        ))}
      </div>
    </div>
  );
}
