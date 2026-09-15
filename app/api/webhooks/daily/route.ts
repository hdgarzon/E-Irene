import { NextResponse } from "next/server";
import {
  isDailyVerificationPing,
  verifyDailySignature,
  type DailyWebhookEvent,
} from "@/lib/video/daily-webhook";
import { parseVideoUserId } from "@/lib/video/participant-id";
import { consumeVideoCall, findVideoConsultationForRoom } from "@/lib/db/video-credits";
import { logger } from "@/lib/logger";

/**
 * Webhook de Daily: la señal de que el paciente se conectó a su videollamada, que es
 * cuando se descuenta del saldo (migración 0058). Se crea con
 * scripts/create-daily-webhook.mjs, suscrito solo a `participant.joined`.
 *
 * Igual que el de Wompi, sin secreto no procesa nada (503). Por lo demás responde
 * 200 aunque no descuente: con 3 fallos seguidos Daily deja el webhook en FAILED y
 * no envía más eventos. Si descontar falla, se registra y lo resuelve el cierre de la
 * consulta, que consulta la API de reuniones (settleVideoCallOnEnd).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.DAILY_WEBHOOK_HMAC;
  if (!secret) {
    logger.error("daily_webhook.missing_secret");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const body = await request.text();
  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(body) as DailyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Al crear el webhook Daily prueba la URL con {"test":"test"} y espera un 200.
  // No se procesa: solo se acusa recibo.
  if (isDailyVerificationPing(event)) {
    return NextResponse.json({ ok: true });
  }

  const valid = verifyDailySignature({
    timestamp: request.headers.get("x-webhook-timestamp"),
    signature: request.headers.get("x-webhook-signature"),
    body,
    secret,
  });
  if (!valid) {
    logger.warn("daily_webhook.invalid_signature", { type: event.type });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  if (event.type !== "participant.joined") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // El profesional no descuenta: solo la conexión del paciente, identificado por el
  // user_id de su token (lib/video/participant-id.ts), nunca contando participantes.
  const participant = parseVideoUserId(event.payload?.user_id);
  const room = event.payload?.room;
  if (participant?.kind !== "patient" || !room) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const joinedAt =
    typeof event.payload?.joined_at === "number"
      ? new Date(event.payload.joined_at * 1000)
      : new Date();

  try {
    const consultation = await findVideoConsultationForRoom({
      appointmentId: participant.appointmentId,
      roomName: room,
      joinedAt,
    });
    if (!consultation) {
      logger.warn("daily_webhook.no_consultation", { appointmentId: participant.appointmentId, room });
      return NextResponse.json({ ok: true, skipped: true });
    }

    const result = await consumeVideoCall({
      consultationId: consultation.consultationId,
      source: `webhook:${event.id ?? "sin_id"}`,
      joinedAt: joinedAt.toISOString(),
    });
    logger.info("daily_webhook.patient_joined", {
      clinicId: consultation.clinicId,
      consultationId: consultation.consultationId,
      result,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    logger.error("daily_webhook.consume_failed", {
      appointmentId: participant.appointmentId,
      room,
      error,
      action: "No se descontó. Lo resuelve el cierre de la consulta con la API de reuniones.",
    });
    return NextResponse.json({ ok: true, deferred: true });
  }
}
