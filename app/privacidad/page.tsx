import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalDocumentPage } from "@/components/legal-document-page";
import { AVISO_PRIVACIDAD } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "Aviso de privacidad — E-Irene",
  description: "Cómo trata E-Irene los datos personales de profesionales, pacientes y visitantes, conforme a la Ley 1581 de 2012.",
};

export default async function Page() {
  // Render dinámico por la CSP con nonce (ver app/(marketing)/page.tsx).
  await connection();
  return <LegalDocumentPage doc={AVISO_PRIVACIDAD} />;
}
