/** Minutos de margen antes/después de la ventana agendada en los que el link
 *  de video sigue siendo válido (permite llegar temprano o cerrar tarde). */
const JOIN_MARGIN_MIN = 15;

/**
 * true si `now` cae dentro de la ventana [scheduledAt - margen, scheduledAt +
 * duración + margen]. Se usa tanto para decidir si /join/[token] deja pasar
 * al paciente como para invalidar el token una vez pasó la ventana.
 */
export function isJoinWindowOpen(params: {
  scheduledAt: string; // ISO
  durationMin: number;
  now?: Date;
}): boolean {
  const now = (params.now ?? new Date()).getTime();
  const scheduled = new Date(params.scheduledAt).getTime();
  const marginMs = JOIN_MARGIN_MIN * 60_000;
  const start = scheduled - marginMs;
  const end = scheduled + params.durationMin * 60_000 + marginMs;
  return now >= start && now <= end;
}
