import type { EmailMessage } from "./types";

function wrap(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f9fc;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#0a2540;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold">E-Irene</div>
    <div style="background:#fff;padding:24px;border:1px solid #e3e8ee;border-top:0;border-radius:0 0 12px 12px;color:#0a2540">
      <h2 style="margin-top:0;color:#0a2540">${title}</h2>
      ${body}
    </div>
    <p style="color:#5b6b7c;font-size:12px;margin-top:16px">Este es un mensaje automático de tu profesional de salud mental.</p>
  </div></body></html>`;
}

export function buildReminderEmail(input: {
  to: string;
  patientName: string;
  clinicName: string;
  dateLabel: string;
  timeLabel: string;
  videoJoinUrl?: string;
}): EmailMessage {
  const videoLine = input.videoJoinUrl
    ? ` Es una consulta por video — entra desde este enlace a la hora de tu cita: ${input.videoJoinUrl}`
    : "";
  const text = `Hola ${input.patientName}, te recordamos tu cita en ${input.clinicName} el ${input.dateLabel} a las ${input.timeLabel}.${videoLine}`;
  return {
    to: input.to,
    subject: `Recordatorio de tu cita · ${input.dateLabel}`,
    text,
    html: wrap(
      "Recordatorio de cita",
      `<p>Hola <strong>${input.patientName}</strong>,</p>
       <p>Te recordamos tu próxima cita en <strong>${input.clinicName}</strong>:</p>
       <p style="background:#f6f9fc;border-radius:8px;padding:12px;font-size:16px">
         📅 ${input.dateLabel} · 🕐 ${input.timeLabel}
       </p>
       ${
         input.videoJoinUrl
           ? `<p>Esta es una consulta por <strong>video</strong>. Entra desde este enlace a la hora de tu cita (no necesitas cuenta ni contraseña):</p>
       <p><a href="${input.videoJoinUrl}" style="display:inline-block;background:#635bff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Entrar a la videollamada</a></p>`
           : ""
       }
       <p>Si necesitas reprogramar, por favor contáctanos.</p>`,
    ),
  };
}

export function buildReportReadyEmail(input: {
  to: string;
  patientName: string;
  clinicName: string;
}): EmailMessage {
  const text = `Hola ${input.patientName}, tu profesional de ${input.clinicName} ha registrado el resumen de tu sesión.`;
  return {
    to: input.to,
    subject: "El resumen de tu sesión está listo",
    text,
    html: wrap(
      "Resumen de sesión disponible",
      `<p>Hola <strong>${input.patientName}</strong>,</p>
       <p>Tu profesional de <strong>${input.clinicName}</strong> ha registrado el resumen de tu última sesión en tu historia clínica.</p>
       <p>Por tu privacidad, el contenido clínico no se envía por correo.</p>`,
    ),
  };
}
