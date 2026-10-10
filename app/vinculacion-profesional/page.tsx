import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalDocumentPage } from "@/components/legal-document-page";
import { VINCULACION_PROFESIONAL } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "Términos de vinculación del profesional — E-Irene",
  description: "Consentimiento y Términos de Vinculación del Profesional de la salud en E-Irene.",
};

export default async function Page() {
  // Render dinámico por la CSP con nonce (ver app/(marketing)/page.tsx).
  await connection();
  return <LegalDocumentPage doc={VINCULACION_PROFESIONAL} />;
}
