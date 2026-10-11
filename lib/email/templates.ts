import type { EmailMessage } from "./types";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapa un valor para interpolarlo en el HTML de un correo, como texto o
 * dentro de un atributo entre comillas. El nombre de la clínica lo escribe el
 * admin de cualquier clínica registrada y el del paciente, el personal de la
 * clínica: sin esto, un `<a href>` en esos campos saldría como enlace real en
 * un correo con la marca de E-Irene.
 *
 * Solo para valores dinámicos. El HTML fijo de las plantillas y lo que reciben
 * `wrap`/`wrapPlatform` ya es HTML armado y no se escapa.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * URL lista para un `href`: escapada y solo si es http(s) absoluta. Las URLs
 * las arma `appBaseUrl()`, pero la plantilla no confía en eso.
 *
 * Con una URL inválida devuelve `null` y la plantilla omite el botón. No lanza
 * a propósito: en las alertas de riesgo el llamador captura el error y el
 * doctor se quedaría sin aviso. Mejor el correo sin botón que ningún correo.
 */
function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? escapeHtml(url) : null;
  } catch {
    return null;
  }
}

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

/**
 * Variante para correos que E-Irene envía **al profesional** por su cuenta, no
 * por cuenta de una clínica. El pie de `wrap()` ("mensaje automático de tu
 * profesional de salud mental") es correcto para pacientes y falso aquí.
 */
function wrapPlatform(
  title: string,
  body: string,
  footer = "Mensaje automático de E-Irene sobre tu cuenta profesional.",
): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f9fc;font-family:Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#0a2540;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-weight:bold">E-Irene</div>
    <div style="background:#fff;padding:24px;border:1px solid #e3e8ee;border-top:0;border-radius:0 0 12px 12px;color:#0a2540">
      <h2 style="margin-top:0;color:#0a2540">${title}</h2>
      ${body}
    </div>
    <p style="color:#5b6b7c;font-size:12px;margin-top:16px">${footer}</p>
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
  const videoHref = safeHref(input.videoJoinUrl);
  return {
    to: input.to,
    subject: `Recordatorio de tu cita · ${input.dateLabel}`,
    text,
    html: wrap(
      "Recordatorio de cita",
      `<p>Hola <strong>${escapeHtml(input.patientName)}</strong>,</p>
       <p>Te recordamos tu próxima cita en <strong>${escapeHtml(input.clinicName)}</strong>:</p>
       <p style="background:#f6f9fc;border-radius:8px;padding:12px;font-size:16px">
         📅 ${escapeHtml(input.dateLabel)} · 🕐 ${escapeHtml(input.timeLabel)}
       </p>
       ${
         videoHref
           ? `<p>Esta es una consulta por <strong>video</strong>. Entra desde este enlace a la hora de tu cita (no necesitas cuenta ni contraseña):</p>
       <p><a href="${videoHref}" style="display:inline-block;background:#635bff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Entrar a la videollamada</a></p>`
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
      `<p>Hola <strong>${escapeHtml(input.patientName)}</strong>,</p>
       <p>Tu profesional de <strong>${escapeHtml(input.clinicName)}</strong> ha registrado el resumen de tu última sesión en tu historia clínica.</p>
       <p>Por tu privacidad, el contenido clínico no se envía por correo.</p>`,
    ),
  };
}

/**
 * Aviso al doctor tratante de una alerta de riesgo detectada por IA.
 *
 * Deliberadamente incluye categoría y nivel (necesarios para que el doctor
 * priorice sin tener que entrar a la plataforma primero) pero NUNCA la cita
 * textual del paciente — mismo principio que `buildReportReadyEmail`: el
 * contenido clínico sensible no viaja por correo, solo vive cifrado en la
 * app. El correo es un aviso con link, no el canal de la evidencia.
 */
export function buildRiskAlertEmail(input: {
  to: string;
  doctorName: string;
  patientName: string;
  clinicName: string;
  consultationUrl: string;
  categories: { label: string; level: string }[];
}): EmailMessage {
  const list = input.categories.map((c) => `${c.label} (${c.level})`).join(", ");
  const text =
    `Hola ${input.doctorName}, el análisis de IA de la sesión con ${input.patientName} en ` +
    `${input.clinicName} detectó posibles indicios de riesgo: ${list}. ` +
    `Revisa el detalle y la evidencia en la plataforma: ${input.consultationUrl} — ` +
    `esto es apoyo a la detección temprana, no un diagnóstico; la decisión y la acción son tuyas.`;
  const htmlList = input.categories
    .map((c) => `${escapeHtml(c.label)} (${escapeHtml(c.level)})`)
    .join(", ");
  const consultationHref = safeHref(input.consultationUrl);
  return {
    to: input.to,
    subject: `⚠️ Alerta de riesgo · ${input.patientName}`,
    text,
    html: wrap(
      "Alerta de riesgo detectada por IA",
      `<p>Hola <strong>${escapeHtml(input.doctorName)}</strong>,</p>
       <p>El análisis de la sesión con <strong>${escapeHtml(input.patientName)}</strong> en <strong>${escapeHtml(input.clinicName)}</strong>
       detectó posibles indicios de riesgo:</p>
       <p style="background:#fdecec;border-radius:8px;padding:12px;font-size:14px;color:#9b1c1c;font-weight:bold">
         ${htmlList}
       </p>
       ${
         consultationHref
           ? `<p><a href="${consultationHref}" style="display:inline-block;background:#635bff;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver detalle y evidencia</a></p>`
           : `<p>Revisa el detalle y la evidencia en la plataforma.</p>`
       }
       <p style="font-size:12px;color:#5b6b7c">Esto es apoyo a la detección temprana — nunca un diagnóstico ni un protocolo de crisis automatizado. La decisión y la acción son siempre tuyas como profesional tratante.</p>`,
    ),
  };
}

export function buildPatientLinkEmail(input: {
  to: string;
  patientName: string;
  clinicName: string;
  url: string;
  purpose: "consent" | "assessment";
}): EmailMessage {
  const isConsent = input.purpose === "consent";
  const subject = isConsent
    ? "Firma tu consentimiento informado"
    : "Completa tu cuestionario de seguimiento";
  const actionLabel = isConsent ? "Firmar consentimiento" : "Responder cuestionario";
  const intro = isConsent
    ? "tu profesional de salud mental te pide firmar el consentimiento informado antes de tu próxima sesión."
    : "tu profesional de salud mental te pide completar un breve cuestionario de seguimiento.";
  const text = `Hola ${input.patientName}, ${intro} Abre este enlace para continuar: ${input.url} (válido por 7 días).`;
  const href = safeHref(input.url);
  return {
    to: input.to,
    subject,
    text,
    html: wrap(
      subject,
      `<p>Hola <strong>${escapeHtml(input.patientName)}</strong>,</p>
       <p>De parte de <strong>${escapeHtml(input.clinicName)}</strong>: ${intro}</p>
       ${
         href
           ? `<p style="margin:20px 0">
         <a href="${href}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
           ${actionLabel}
         </a>
       </p>`
           : ""
       }
       <p style="font-size:13px;color:#5b6b7c">Este enlace es personal y vence en 7 días. Si no esperabas este correo, puedes ignorarlo.</p>`,
    ),
  };
}

/**
 * Aviso al doctor de un PHQ-9 autorreportado (link público) cuya respuesta
 * indica riesgo de autolesión. Deliberadamente NO nombra la categoría en el
 * asunto/cuerpo ("respuesta que requiere tu atención", no "autolesión") —
 * a diferencia de `buildRiskAlertEmail` (fuente IA), donde el doctor ya
 * espera ver categoría/nivel; aquí es un correo que puede llegar sin
 * contexto previo, y nombrar el riesgo explícito en un asunto de correo es
 * innecesariamente expositivo para el paciente si alguien más lo ve.
 */
export function buildPhq9RiskAlertEmail(input: {
  to: string;
  doctorName: string;
  patientName: string;
  clinicName: string;
  patientUrl: string;
}): EmailMessage {
  const text = `Hola ${input.doctorName}, ${input.patientName} completó un cuestionario en ${input.clinicName} con una respuesta que requiere tu atención. Revísalo aquí: ${input.patientUrl}`;
  const patientHref = safeHref(input.patientUrl);
  return {
    to: input.to,
    subject: "Alerta: respuesta que requiere tu atención",
    text,
    html: wrap(
      "Alerta de seguimiento",
      `<p>Hola <strong>${escapeHtml(input.doctorName)}</strong>,</p>
       <p><strong>${escapeHtml(input.patientName)}</strong> completó un cuestionario de seguimiento en
       <strong>${escapeHtml(input.clinicName)}</strong> con una respuesta que requiere tu atención
       cercana.</p>
       ${
         patientHref
           ? `<p style="margin:20px 0">
         <a href="${patientHref}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
           Ver expediente del paciente
         </a>
       </p>`
           : `<p>Revisa el expediente del paciente en la plataforma.</p>`
       }
       <p style="font-size:13px;color:#5b6b7c">Por privacidad del paciente, el detalle clínico no se envía por correo.</p>`,
    ),
  };
}

/**
 * Decisión sobre la verificación de habilitación profesional.
 *
 * Sin este correo, el profesional solo se entera de la decisión si vuelve a
 * entrar a la plataforma — y quien fue rechazado no tiene motivo para volver,
 * así que nunca sabría qué corregir.
 *
 * El motivo del rechazo sí viaja en el correo: es información sobre el propio
 * destinatario y es justo lo que necesita para poder subsanar.
 */
export function buildVerificationDecisionEmail(input: {
  to: string;
  doctorName: string;
  decision: "verified" | "rejected" | "suspended";
  notes?: string | null;
  actionUrl: string;
}): EmailMessage {
  const nombre = input.doctorName.split(" ")[0] || input.doctorName;
  const actionHref = safeHref(input.actionUrl);

  if (input.decision === "verified") {
    return {
      to: input.to,
      subject: "Tu verificación profesional fue aprobada",
      text:
        `Hola ${nombre}, verificamos tu habilitación profesional y tu cuenta ya tiene acceso ` +
        `completo a E-Irene: puedes registrar pacientes y transcribir sesiones. ${input.actionUrl}`,
      html: wrapPlatform(
        "Verificación aprobada",
        `<p>Hola <strong>${escapeHtml(nombre)}</strong>,</p>
         <p>Verificamos tu habilitación profesional. Tu cuenta ya tiene <strong>acceso completo</strong>:
         puedes registrar pacientes y transcribir sesiones.</p>
         ${
           actionHref
             ? `<p style="margin:20px 0">
           <a href="${actionHref}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
             Entrar a la plataforma
           </a>
         </p>`
             : ""
         }`,
      ),
    };
  }

  const esRechazo = input.decision === "rejected";
  const titulo = esRechazo ? "No pudimos verificar tu habilitación" : "Tu verificación fue suspendida";
  const motivo = input.notes?.trim();

  return {
    to: input.to,
    subject: esRechazo
      ? "No pudimos verificar tu habilitación profesional"
      : "Tu verificación profesional fue suspendida",
    text:
      `Hola ${nombre}, ${titulo.toLowerCase()}.` +
      (motivo ? ` Motivo: ${motivo}.` : "") +
      (esRechazo
        ? ` Puedes volver a enviar tus documentos aquí: ${input.actionUrl}`
        : ` Escríbenos para revisar tu caso.`),
    html: wrapPlatform(
      titulo,
      `<p>Hola <strong>${escapeHtml(nombre)}</strong>,</p>
       <p>${
         esRechazo
           ? "Revisamos los documentos que enviaste y no pudimos confirmar tu habilitación profesional."
           : "Suspendimos la verificación de tu cuenta, por lo que no podrás registrar pacientes ni transcribir sesiones."
       }</p>
       ${
         motivo
           ? `<p style="background:#fdecec;border-radius:8px;padding:12px;font-size:14px;color:#9b1c1c">
                <strong>Motivo:</strong> ${escapeHtml(motivo)}
              </p>`
           : ""
       }
       ${
         esRechazo
           ? actionHref
             ? `<p>Puedes corregir lo señalado y volver a enviar tus documentos:</p>
              <p style="margin:20px 0">
                <a href="${actionHref}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
                  Reenviar documentos
                </a>
              </p>`
             : `<p>Puedes corregir lo señalado y volver a enviar tus documentos desde la plataforma.</p>`
           : `<p>Si crees que se trata de un error, responde a este correo para revisar tu caso.</p>`
       }
       <p style="font-size:13px;color:#5b6b7c">Los registros clínicos que ya creaste siguen accesibles: continúas siendo responsable de esas historias.</p>`,
    ),
  };
}

/**
 * Documentos devueltos a una cuenta heredada (migración 0044). No es un rechazo:
 * la cuenta conserva el acceso y solo tiene que volver a subirlos antes del
 * plazo. Con la plantilla de rechazo leería que perdió el acceso a registrar
 * pacientes, y no es cierto.
 */
export function buildLegacyDocumentsReturnedEmail(input: {
  to: string;
  doctorName: string;
  reason: string;
  /** Fecha legible del plazo, p. ej. "18 de octubre de 2026". */
  deadline: string;
  actionUrl: string;
}): EmailMessage {
  const nombre = input.doctorName.split(" ")[0] || input.doctorName;
  const motivo = input.reason.trim();
  const actionHref = safeHref(input.actionUrl);

  return {
    to: input.to,
    subject: "Necesitamos que vuelvas a subir tus documentos",
    text:
      `Hola ${nombre}, revisamos los documentos que subiste para confirmar tu habilitación ` +
      `profesional y necesitamos que los vuelvas a enviar. Motivo: ${motivo}. Súbelos antes del ` +
      `${input.deadline}; mientras tanto conservas el acceso. ${input.actionUrl}`,
    html: wrapPlatform(
      "Vuelve a subir tus documentos",
      `<p>Hola <strong>${escapeHtml(nombre)}</strong>,</p>
       <p>Revisamos los documentos que subiste para confirmar tu habilitación profesional y
       necesitamos que los vuelvas a enviar.</p>
       <p style="background:#fff7e6;border-radius:8px;padding:12px;font-size:14px;color:#8a5300">
         <strong>Motivo:</strong> ${escapeHtml(motivo)}
       </p>
       <p>Súbelos antes del <strong>${escapeHtml(input.deadline)}</strong>. Mientras tanto
       <strong>conservas el acceso</strong> a la plataforma.</p>
       ${
         actionHref
           ? `<p style="margin:20px 0">
         <a href="${actionHref}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">
           Subir documentos
         </a>
       </p>`
           : ""
       }`,
    ),
  };
}

const PQR_FOOTER = "Mensaje automático de E-Irene. Conserve este correo como constancia de su radicado.";

/**
 * Constancia para quien presenta una PQR: número de radicado y fecha y hora de
 * presentación (Ley 1480, art. 50 lit. g), y el plazo de respuesta.
 */
export function buildPqrReceiptEmail(input: {
  to: string;
  fullName: string;
  radicado: string;
  kindLabel: string;
  submittedAt: string;
  dueDate: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: `Radicamos su ${input.kindLabel.toLowerCase()}: ${input.radicado}`,
    text:
      `Hola ${input.fullName}, recibimos su ${input.kindLabel.toLowerCase()} con el radicado ` +
      `${input.radicado}, presentada el ${input.submittedAt}. La responderemos a más tardar el ` +
      `${input.dueDate} (15 días hábiles). También puede acudir a la Superintendencia de ` +
      `Industria y Comercio.`,
    html: wrapPlatform(
      "Recibimos su solicitud",
      `<p>Hola <strong>${escapeHtml(input.fullName)}</strong>,</p>
       <p>Recibimos su ${escapeHtml(input.kindLabel.toLowerCase())}. Estos son sus datos de radicación:</p>
       <p style="background:#f0f4f8;border-radius:8px;padding:12px;font-size:14px">
         <strong>Radicado:</strong> ${escapeHtml(input.radicado)}<br />
         <strong>Presentada:</strong> ${escapeHtml(input.submittedAt)}<br />
         <strong>Respuesta a más tardar:</strong> ${escapeHtml(input.dueDate)}
       </p>
       <p style="font-size:13px;color:#5b6b7c">El plazo es de quince (15) días hábiles, sin perjuicio de su derecho a acudir directamente a la Superintendencia de Industria y Comercio.</p>`,
      PQR_FOOTER,
    ),
  };
}

/** Aviso al buzón de PQR: llegó una nueva, con su plazo. */
export function buildPqrNotificationEmail(input: {
  to: string;
  radicado: string;
  kindLabel: string;
  fullName: string;
  email: string;
  phone: string | null;
  message: string;
  submittedAt: string;
  dueDate: string;
  adminUrl: string;
}): EmailMessage {
  const href = safeHref(input.adminUrl);
  return {
    to: input.to,
    subject: `Nueva PQR ${input.radicado} (${input.kindLabel}) · responder antes del ${input.dueDate}`,
    text:
      `${input.kindLabel} ${input.radicado} de ${input.fullName} <${input.email}>` +
      (input.phone ? `, tel. ${input.phone}` : "") +
      `, presentada el ${input.submittedAt}. Responder a más tardar el ${input.dueDate}.\n\n` +
      `${input.message}\n\n${input.adminUrl}`,
    html: wrapPlatform(
      `Nueva PQR: ${escapeHtml(input.radicado)}`,
      `<p><strong>${escapeHtml(input.kindLabel)}</strong> de ${escapeHtml(input.fullName)}
         &lt;${escapeHtml(input.email)}&gt;${input.phone ? `, tel. ${escapeHtml(input.phone)}` : ""}.</p>
       <p>Presentada el ${escapeHtml(input.submittedAt)}. <strong>Responder a más tardar el ${escapeHtml(input.dueDate)}.</strong></p>
       <p style="background:#f0f4f8;border-radius:8px;padding:12px;font-size:14px;white-space:pre-wrap">${escapeHtml(input.message)}</p>
       ${href ? `<p><a href="${href}">Ver en la consola</a></p>` : ""}`,
      "Aviso automático de E-Irene para el buzón de PQR.",
    ),
  };
}

/**
 * Confirmación de la solicitud de eliminación de la cuenta (Términos de
 * Vinculación, cláusula séptima, numeral 5): cuándo se suprime, que hay que
 * exportar antes, y que se puede desistir hasta esa fecha.
 */
export function buildAccountDeletionRequestedEmail(input: {
  to: string;
  name: string;
  clinicName: string;
  scheduledFor: string;
  settingsUrl: string;
}): EmailMessage {
  const nombre = input.name.split(" ")[0] || input.name;
  const href = safeHref(input.settingsUrl);
  return {
    to: input.to,
    subject: `Solicitud de eliminación de la cuenta de ${input.clinicName}`,
    text:
      `Hola ${nombre}, recibimos la solicitud de eliminar la cuenta de ${input.clinicName}. ` +
      `El ${input.scheduledFor} suprimiremos de forma definitiva los datos de la cuenta y de sus ` +
      `pacientes. Antes de esa fecha exporta la información de tus pacientes: como Responsable ` +
      `debes conservar las historias clínicas por 15 años. Puedes desistir hasta esa fecha desde ` +
      `Configuración: ${input.settingsUrl}`,
    html: wrapPlatform(
      "Solicitud de eliminación de la cuenta",
      `<p>Hola <strong>${escapeHtml(nombre)}</strong>,</p>
       <p>Recibimos la solicitud de eliminar la cuenta de <strong>${escapeHtml(input.clinicName)}</strong>.</p>
       <p style="background:#fdecec;border-radius:8px;padding:12px;font-size:14px;color:#9b1c1c">
         El <strong>${escapeHtml(input.scheduledFor)}</strong> suprimiremos de forma definitiva los datos de la cuenta y de sus pacientes.
       </p>
       <p><strong>Exporta antes la información de tus pacientes:</strong> como Responsable debes conservar las historias clínicas por 15 años (Resolución 839 de 2017).</p>
       <p>Puedes desistir en cualquier momento antes de esa fecha.</p>
       ${
         href
           ? `<p style="margin:20px 0"><a href="${href}" style="background:#635bff;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Exportar o desistir</a></p>`
           : ""
       }`,
    ),
  };
}

/**
 * Aviso de cambios en los documentos legales (Política de Tratamiento, sección
 * 10; Términos de Vinculación, cláusula décima): qué cambia, desde cuándo, y el
 * derecho a terminar sin penalidad si el cambio es desfavorable.
 */
export function buildLegalNoticeEmail(input: {
  to: string;
  name: string;
  title: string;
  body: string;
  effectiveDate: string;
  documentsUrl: string;
}): EmailMessage {
  const nombre = input.name.split(" ")[0] || input.name;
  const href = safeHref(input.documentsUrl);
  return {
    to: input.to,
    subject: `Aviso: ${input.title} (vigente desde el ${input.effectiveDate})`,
    text:
      `Hola ${nombre}. ${input.title}. Vigente desde el ${input.effectiveDate}.\n\n${input.body}\n\n` +
      `Si el cambio te resulta desfavorable puedes terminar la relación sin penalidad antes de esa fecha ` +
      `(Términos de Vinculación, cláusula décima). Documentos: ${input.documentsUrl}`,
    html: wrapPlatform(
      escapeHtml(input.title),
      `<p>Hola <strong>${escapeHtml(nombre)}</strong>,</p>
       <p>Te avisamos con anticipación de un cambio en los documentos que rigen el servicio. <strong>Entra en vigor el ${escapeHtml(input.effectiveDate)}.</strong></p>
       <p style="background:#f0f4f8;border-radius:8px;padding:12px;font-size:14px;white-space:pre-wrap">${escapeHtml(input.body)}</p>
       <p style="font-size:13px;color:#5b6b7c">Si el cambio te resulta desfavorable, puedes terminar la relación sin penalidad antes de esa fecha (Términos de Vinculación, cláusula décima).</p>
       ${href ? `<p><a href="${href}">Ver los documentos</a></p>` : ""}`,
    ),
  };
}

/**
 * Confirmación de un pago (Términos y Condiciones, cláusula duodécima,
 * numeral 5): el concepto, el precio, la fecha y el período cubierto.
 */
export function buildPaymentConfirmationEmail(input: {
  to: string;
  clinicName: string;
  concept: string;
  amount: string;
  paidAt: string;
  coverage: string;
  reference: string;
  settingsUrl: string;
}): EmailMessage {
  const href = safeHref(input.settingsUrl);
  return {
    to: input.to,
    subject: `Pago recibido: ${input.concept}`,
    text:
      `Recibimos el pago de ${input.clinicName}. Concepto: ${input.concept}. Valor: ${input.amount} ` +
      `(IVA incluido). Fecha: ${input.paidAt}. Período cubierto: ${input.coverage}. ` +
      `Referencia: ${input.reference}. ${input.settingsUrl}`,
    html: wrapPlatform(
      "Pago recibido",
      `<p>Recibimos el pago de <strong>${escapeHtml(input.clinicName)}</strong>.</p>
       <p style="background:#f0f4f8;border-radius:8px;padding:12px;font-size:14px">
         <strong>Concepto:</strong> ${escapeHtml(input.concept)}<br />
         <strong>Valor:</strong> ${escapeHtml(input.amount)} (IVA incluido)<br />
         <strong>Fecha:</strong> ${escapeHtml(input.paidAt)}<br />
         <strong>Período cubierto:</strong> ${escapeHtml(input.coverage)}<br />
         <strong>Referencia:</strong> ${escapeHtml(input.reference)}
       </p>
       ${href ? `<p><a href="${href}">Ver Plan y facturación</a></p>` : ""}`,
    ),
  };
}
