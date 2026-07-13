import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getConsultation } from "@/lib/db/consultations";
import { getReportByConsultation } from "@/lib/db/reports";
import { getSoapNoteByConsultation } from "@/lib/db/soap-notes";
import { renderReportPdf } from "@/lib/pdf/report-pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const { id } = await params;
  const [consultation, report, soapNote] = await Promise.all([
    getConsultation(id),
    getReportByConsultation(id),
    getSoapNoteByConsultation(id),
  ]);
  if (!consultation || !report) return new Response("No encontrado", { status: 404 });
  // Defensa en profundidad: además de RLS, exige que la consulta pertenezca a
  // la clínica del usuario. Bloquea el acceso cross-tenant (incl. platform
  // admins, cuyo RLS extendido no debe alcanzar contenido clínico en PDF).
  if (consultation.clinicId !== user.clinicId) {
    return new Response("No encontrado", { status: 404 });
  }

  const buffer = await renderReportPdf({
    report,
    patientName: consultation.patientName,
    clinicName: user.clinicName,
    doctorName: consultation.doctorName,
    date: new Date(consultation.startedAt).toLocaleString("es-CO"),
    reason: consultation.reason,
    soapNote,
    validatedAt: report.validatedAt,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="reporte-eirene-${id.slice(0, 8)}.pdf"`,
    },
  });
}
