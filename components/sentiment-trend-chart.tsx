import type { TrendPoint } from "@/lib/progress";

const COLOR: Record<string, string> = {
  positivo: "#00d4aa",
  neutral: "#635bff",
  negativo: "#ff6b6b",
};

/** Gráfico de línea (SVG) de la tendencia de sentimiento entre sesiones. */
export function SentimentTrendChart({ points }: { points: TrendPoint[] }) {
  const W = 320;
  const H = 120;
  const pad = 16;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const n = points.length;

  const x = (i: number) => (n === 1 ? W / 2 : pad + (i / (n - 1)) * innerW);
  const y = (score: number) => pad + ((1 - score) / 2) * innerH; // 1→top, -1→bottom

  const line = points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Tendencia de sentimiento">
      {/* baselines */}
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke="#e3e8ee" strokeWidth="1" />
      <line x1={pad} y1={y(1)} x2={W - pad} y2={y(1)} stroke="#f0f3f7" strokeWidth="1" />
      <line x1={pad} y1={y(-1)} x2={W - pad} y2={y(-1)} stroke="#f0f3f7" strokeWidth="1" />

      {n > 1 && (
        <polyline points={line} fill="none" stroke="#635bff" strokeWidth="2" strokeLinecap="round" />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score)} r="4" fill={COLOR[p.label] ?? "#635bff"} />
      ))}

      <text x={pad} y={y(1) - 3} fontSize="8" fill="#5b6b7c">
        +1 positivo
      </text>
      <text x={pad} y={y(-1) + 10} fontSize="8" fill="#5b6b7c">
        −1 negativo
      </text>
    </svg>
  );
}
