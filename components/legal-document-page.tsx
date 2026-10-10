import Link from "next/link";
import { ArrowLeft, FileDown } from "lucide-react";
import { LegalDocumentBody } from "@/components/legal-document";
import {
  PUBLISHED_LEGAL_DOCUMENTS,
  legalPdfPath,
  type LegalDocument,
} from "@/lib/legal-documents";

/** Página pública de un documento legal, con su PDF y enlaces a los demás. */
export function LegalDocumentPage({ doc }: { doc: LegalDocument }) {
  const others = PUBLISHED_LEGAL_DOCUMENTS.filter((d) => d.slug !== doc.slug);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-navy"
      >
        <ArrowLeft className="size-4" />
        Volver al inicio
      </Link>

      <h1 className="mt-6 font-heading text-3xl font-bold text-navy">{doc.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {doc.subtitle ? `${doc.subtitle} · ` : ""}Versión {doc.version} · Vigente desde{" "}
        {doc.effectiveDate}
      </p>
      <a
        href={legalPdfPath(doc)}
        className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <FileDown className="size-4" />
        Descargar en PDF
      </a>

      <div className="mt-8">
        <LegalDocumentBody doc={doc} />
      </div>

      <nav className="mt-12 border-t border-gray-line pt-6 text-sm">
        <p className="mb-2 text-muted-foreground">Otros documentos</p>
        <ul className="space-y-1.5">
          {others.map((d) => (
            <li key={d.slug}>
              <Link href={`/${d.slug}`} className="text-primary hover:underline">
                {d.title}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/seguridad" className="text-primary hover:underline">
              Controles de seguridad y cumplimiento
            </Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}
