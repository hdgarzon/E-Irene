/**
 * Identidad de quien entra a una sala de Daily (migración 0058).
 *
 * El token de cada participante lleva un `user_id` que Daily repite en sus eventos
 * (participant.joined) y en la API de reuniones. Con él el servidor sabe que se
 * conectó el paciente de una cita, sin contar participantes. Daily limita `user_id`
 * a 36 caracteres: una letra, un guion y el UUID sin guiones ocupan 34.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compact(uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new Error("Se esperaba un UUID");
  return uuid.replace(/-/g, "").toLowerCase();
}

function expand(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `user_id` del paciente de una cita: `p-<id de la cita sin guiones>`. */
export function patientVideoUserId(appointmentId: string): string {
  return `p-${compact(appointmentId)}`;
}

/** `user_id` del profesional: `d-<id del usuario sin guiones>`. */
export function doctorVideoUserId(userId: string): string {
  return `d-${compact(userId)}`;
}

export type VideoParticipant =
  | { kind: "patient"; appointmentId: string }
  | { kind: "doctor"; userId: string };

/** Lee un `user_id` emitido por esta app; null para cualquier otro valor. */
export function parseVideoUserId(userId: string | null | undefined): VideoParticipant | null {
  const match = /^([pd])-([0-9a-f]{32})$/.exec(userId ?? "");
  if (!match) return null;
  const id = expand(match[2]);
  return match[1] === "p" ? { kind: "patient", appointmentId: id } : { kind: "doctor", userId: id };
}
