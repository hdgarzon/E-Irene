import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getConsultation, getTranscript } from "@/lib/db/consultations";
import { getReportByConsultation } from "@/lib/db/reports";
import { renderReportPdf } from "@/lib/pdf/report-pdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const { id } = await params;
  const [consultation, report, transcript] = await Promise.all([
    getConsultation(id),
    getReportByConsultation(id),
    getTranscript(id),
  ]);
  if (!consultation || !report) return new Response("No encontrado", { status: 404 });

  const buffer = await renderReportPdf({
    report,
    patientName: consultation.patientName,
    clinicName: user.clinicName,
    doctorName: consultation.doctorName,
    date: new Date(consultation.startedAt).toLocaleString("es-CO"),
    reason: consultation.reason,
    transcript,
    validatedAt: report.validatedAt,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="reporte-eirene-${id.slice(0, 8)}.pdf"`,
    },
  });
}
