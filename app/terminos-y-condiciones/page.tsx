import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalDocumentPage } from "@/components/legal-document-page";
import { TERMINOS_USO } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "Términos y condiciones de uso — E-Irene",
  description: "Términos y Condiciones de Uso del sitio y la plataforma E-Irene.",
};

export default async function Page() {
  // Render dinámico por la CSP con nonce (ver app/(marketing)/page.tsx).
  await connection();
  return <LegalDocumentPage doc={TERMINOS_USO} />;
}
