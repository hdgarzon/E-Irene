import type { Metadata } from "next";
import { connection } from "next/server";
import { LegalDocumentPage } from "@/components/legal-document-page";
import { POLITICA_DATOS } from "@/lib/legal-documents";

export const metadata: Metadata = {
  title: "Política de tratamiento de datos personales — E-Irene",
  description: "Política de Tratamiento de Datos Personales de E-Irene, conforme a la Ley 1581 de 2012.",
};

export default async function Page() {
  // Render dinámico por la CSP con nonce (ver app/(marketing)/page.tsx).
  await connection();
  return <LegalDocumentPage doc={POLITICA_DATOS} />;
}
