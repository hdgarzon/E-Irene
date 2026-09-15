import { PLANS, type Plan, type PlanLimits } from "@/lib/plans";
import { getClinicSubscription } from "@/lib/db/clinic";
import {
  attachVideoReservation,
  consumeVideoCall,
  getConsultationVideoContext,
  getVideoCredits,
  getVideoReservationStatus,
  releaseVideoCall,
  releaseVideoReservation,
  reserveVideoCall,
} from "@/lib/db/video-credits";
import { getVideoProvider } from "@/lib/video";
import { DailyVideoProvider } from "@/lib/video/daily";
import { patientVideoUserId } from "@/lib/video/participant-id";
import { logger } from "@/lib/logger";

/**
 * Quién usa videollamadas y cuándo se descuentan (migración 0058). Free no tiene;
 * Esencial, Profesional y Clínica las compran por packs; Enterprise las incluye.
 */

export type PlanVideoMode = PlanLimits["video"];

export const VIDEO_GATE_MESSAGES = {
  plan: (planLabel: string) =>
    `El plan ${planLabel} no incluye videollamadas. Cambia a un plan pago en Plan y facturación para usarlas.`,
  credits:
    "No tienes videollamadas disponibles. Compra un pack en Plan y facturación para iniciar esta consulta por video.",
} as const;

export type VideoPackAvailability = "available" | "not_eligible";

/** Los packs se venden a los planes que compran video como adicional, con período pagado vigente. */
export function videoPackAvailability(input: {
  plan: Plan;
  hasPaidPeriod: boolean;
}): VideoPackAvailability {
  return input.hasPaidPeriod && PLANS[input.plan].video === "addon" ? "available" : "not_eligible";
}

export type VideoAccess = { allowed: true } | { allowed: false; reason: "plan" | "credits" };

/**
 * ¿Se le emite al profesional el token de la sala de esta consulta? Con el plan que
 * incluye video, sí; sin video en el plan, no; con video como adicional, solo si la
 * consulta tiene su reserva. Una consulta en curso sin reserva (iniciada antes de
 * esta versión, o si enlazarla falló) reserva ahora con la misma regla que el inicio.
 */
export async function ensureConsultationVideoAccess(input: {
  plan: Plan;
  appointmentId: string;
  consultationId: string;
}): Promise<VideoAccess> {
  const mode = PLANS[input.plan].video;
  if (mode === "included") return { allowed: true };
  if (mode === "none") return { allowed: false, reason: "plan" };

  const status = await getVideoReservationStatus(input.consultationId);
  if (status === "held" || status === "consumed") return { allowed: true };

  const reservation = await reserveVideoCall(input.appointmentId);
  if (reservation.status !== "reserved") return { allowed: false, reason: "credits" };
  if (!(await attachVideoReservation(reservation.reservationId, input.consultationId))) {
    await releaseVideoReservation(reservation.reservationId, "no_se_pudo_enlazar");
    return { allowed: false, reason: "credits" };
  }
  return { allowed: true };
}

/** Aviso junto al selector de modalidad al agendar por video. Agendar no descuenta nada. */
export async function getVideoSchedulingNotice(): Promise<string | null> {
  const { plan } = await getClinicSubscription();
  const mode = PLANS[plan].video;
  if (mode === "included") return null;
  if (mode === "none") {
    return `El plan ${PLANS[plan].label} no incluye videollamadas: puedes agendar, pero no iniciar la consulta por video.`;
  }
  const { available } = await getVideoCredits();
  if (available <= 0) {
    return "No tienes videollamadas disponibles. Puedes agendar, pero para iniciar la consulta por video necesitas un pack.";
  }
  return `Tienes ${available} videollamada${available === 1 ? "" : "s"} disponible${
    available === 1 ? "" : "s"
  }. Agendar no descuenta: se descuenta al iniciar, si el paciente se conecta.`;
}

/**
 * ¿El paciente de la consulta se conectó? Lo responde la API de reuniones de Daily.
 * Devuelve la hora de conexión, null si no se conectó, o undefined si no se pudo
 * saber (sin Daily, sin sala o error de la API).
 */
async function patientJoinFromMeetings(consultationId: string): Promise<Date | null | undefined> {
  const provider = getVideoProvider();
  if (!(provider instanceof DailyVideoProvider)) return undefined;
  const context = await getConsultationVideoContext(consultationId);
  if (!context) return undefined;

  const startedSec = Math.floor(new Date(context.startedAt).getTime() / 1000);
  const endedSec = Math.floor(new Date(context.endedAt ?? Date.now()).getTime() / 1000);
  try {
    const participants = await provider.listMeetingParticipants({
      roomName: context.roomName,
      sinceUnix: startedSec - 3600,
    });
    const patient = patientVideoUserId(context.appointmentId);
    // join_time tiene ~15 s de granularidad: un minuto de margen a cada lado.
    const join = participants
      .filter((p) => p.userId === patient && p.joinTime >= startedSec - 60 && p.joinTime <= endedSec + 60)
      .sort((a, b) => a.joinTime - b.joinTime)[0];
    return join ? new Date(join.joinTime * 1000) : null;
  } catch (error) {
    logger.warn("video.meetings_lookup_failed", { consultationId, error });
    return undefined;
  }
}

/**
 * Al cerrar una consulta por video: si su reserva sigue abierta (el webhook de Daily
 * no la descontó), se consulta la API de reuniones. Si el paciente se conectó, se
 * descuenta; si no, o si no se puede confirmar, se libera. Ante la duda, no se cobra.
 */
export async function settleVideoCallOnEnd(
  consultationId: string,
): Promise<"consumed" | "released" | "none"> {
  if ((await getVideoReservationStatus(consultationId)) !== "held") return "none";

  const joinedAt = await patientJoinFromMeetings(consultationId);
  if (joinedAt) {
    const result = await consumeVideoCall({
      consultationId,
      source: "reuniones_al_finalizar",
      joinedAt: joinedAt.toISOString(),
    });
    if (result === "consumed" || result === "already_consumed") return "consumed";
  }

  await releaseVideoCall(
    consultationId,
    joinedAt === undefined ? "sin_confirmacion" : "paciente_no_se_conecto",
  );
  return "released";
}
