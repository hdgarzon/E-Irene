import type { NextRequest } from "next/server";
import { findPublishedDocument } from "@/lib/legal-documents";
import { renderLegalDocumentPdf } from "@/lib/pdf/legal-document-pdf";

/**
 * PDF de los documentos legales publicados (/documentos/<slug>.pdf). Se genera
 * del mismo texto que la página y que el hash de la aceptación: no hay un PDF
 * suelto que pueda quedar desactualizado respecto de lo que se acepta.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const slug = file.endsWith(".pdf") ? file.slice(0, -".pdf".length) : null;
  const doc = slug ? findPublishedDocument(slug) : undefined;
  if (!doc) return new Response("No encontrado", { status: 404 });

  const buffer = await renderLegalDocumentPdf(doc);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${doc.slug}-v${doc.version}.pdf"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
