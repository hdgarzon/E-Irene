/** Gráfico de línea (SVG) para una métrica en escala 0..max entre aplicaciones. */
export function ScoreTrendChart({
  points,
  max,
  color = "#635bff",
}: {
  points: { date: string; score: number }[];
  max: number;
  color?: string;
}) {
  const W = 320;
  const H = 120;
  const pad = 16;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const n = points.length;

  const x = (i: number) => (n === 1 ? W / 2 : pad + (i / (n - 1)) * innerW);
  const y = (score: number) => pad + (1 - score / max) * innerH;

  const line = points.map((p, i) => `${x(i)},${y(p.score)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evolución del puntaje">
      <line x1={pad} y1={y(0)} x2={W - pad} y2={y(0)} stroke="#e3e8ee" strokeWidth="1" />
      <line x1={pad} y1={y(max)} x2={W - pad} y2={y(max)} stroke="#f0f3f7" strokeWidth="1" />

      {n > 1 && (
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.score)} r="4" fill={color} />
      ))}

      <text x={pad} y={y(max) - 3} fontSize="8" fill="#5b6b7c">
        {max}
      </text>
      <text x={pad} y={y(0) + 10} fontSize="8" fill="#5b6b7c">
        0
      </text>
    </svg>
  );
}
