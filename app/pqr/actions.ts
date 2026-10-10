"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createPqr } from "@/lib/db/pqr";
import { PQR_KINDS, PQR_KIND_LABEL, pqrDueDate } from "@/lib/pqr";
import { getEmailProvider } from "@/lib/email/providers";
import { buildPqrNotificationEmail, buildPqrReceiptEmail } from "@/lib/email/templates";
import { PQR_INBOX_EMAIL } from "@/lib/legal-documents/urls";
import { appBaseUrl } from "@/lib/app-url";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { formatLongDate, formatTime } from "@/lib/dates";
import { logger } from "@/lib/logger";

export type PqrState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  receipt?: { radicado: string; submittedAt: string; dueDate: string; email: string };
};

const schema = z.object({
  kind: z.enum(PQR_KINDS, { error: "Elige el tipo de solicitud" }),
  fullName: z.string().trim().min(3, "Ingresa tu nombre completo").max(200),
  email: z.email("Correo inválido").max(320),
  phone: z.string().trim().max(40).optional(),
  message: z
    .string()
    .trim()
    .min(10, "Cuéntanos un poco más (mínimo 10 caracteres)")
    .max(5000, "Máximo 5.000 caracteres"),
});

function flattenFieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** "9 de octubre de 2026, 15:42": fecha y hora de presentación en Bogotá. */
function submittedLabel(iso: string): string {
  return `${formatLongDate(iso)}, ${formatTime(iso)}`;
}

export async function submitPqrAction(_prev: PqrState, formData: FormData): Promise<PqrState> {
  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    message: formData.get("message"),
  });
  const fieldErrors = parsed.success ? {} : flattenFieldErrors(parsed.error);
  // Política de tratamiento, 3.1 bis: la base para tratar estos datos es la
  // autorización que se otorga al enviar el formulario.
  if (formData.get("dataAuthorization") !== "on") {
    fieldErrors.dataAuthorization = "Debes autorizar el tratamiento de tus datos para radicar la solicitud";
  }
  if (!parsed.success || Object.keys(fieldErrors).length) return { fieldErrors };

  // Formulario público sin sesión: se limita por IP para que no sirva para
  // inundar el buzón ni la tabla.
  const ip = await getClientIp();
  if (!(await checkRateLimit(`pqr:ip:${ip}`, 5, 3600))) {
    return { error: "Demasiadas solicitudes desde esta conexión. Intenta de nuevo en una hora." };
  }

  const h = await headers();
  const { kind, fullName, email, phone, message } = parsed.data;

  let pqr;
  try {
    pqr = await createPqr({
      kind,
      fullName,
      email: email.toLowerCase(),
      phone: phone || null,
      message,
      ip: ip === "unknown" ? null : ip,
      userAgent: h.get("user-agent"),
    });
  } catch (error) {
    logger.error("pqr.create_failed", { error });
    return {
      error: `No pudimos radicar tu solicitud. Intenta de nuevo en unos minutos o escribe a ${PQR_INBOX_EMAIL}.`,
    };
  }

  const submittedAt = submittedLabel(pqr.createdAt);
  const dueDate = formatLongDate(`${pqrDueDate(pqr.createdAt)}T12:00:00-05:00`);
  const kindLabel = PQR_KIND_LABEL[pqr.kind];

  // La PQR ya quedó radicada: los correos no la condicionan. Si fallan, quien la
  // presentó igual ve su radicado en pantalla y el equipo la ve en /admin/pqr.
  const mailer = getEmailProvider();
  const results = await Promise.allSettled([
    mailer.send(
      buildPqrReceiptEmail({ to: pqr.email, fullName, radicado: pqr.radicado, kindLabel, submittedAt, dueDate }),
    ),
    mailer.send(
      buildPqrNotificationEmail({
        to: PQR_INBOX_EMAIL,
        radicado: pqr.radicado,
        kindLabel,
        fullName,
        email: pqr.email,
        phone: pqr.phone,
        message,
        submittedAt,
        dueDate,
        adminUrl: `${appBaseUrl()}/admin/pqr?q=${encodeURIComponent(pqr.radicado)}`,
      }),
    ),
  ]);
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.error(i === 0 ? "pqr.receipt_email_failed" : "pqr.inbox_email_failed", {
        radicado: pqr.radicado,
        error: r.reason,
      });
    }
  });

  return { receipt: { radicado: pqr.radicado, submittedAt, dueDate, email: pqr.email } };
}
