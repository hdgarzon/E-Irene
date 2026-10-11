import Link from "next/link";
import { ScrollText } from "lucide-react";
import { formatLongDate } from "@/lib/dates";
import { PROFESSIONAL_TERMS_PATH } from "@/lib/legal-documents/urls";
import type { LegalNotice } from "@/lib/db/legal-notices";

/** Aviso en la plataforma de un cambio legal próximo (Vinculación, cláusula décima). */
export function LegalNoticeBanner({ notice }: { notice: LegalNotice }) {
  return (
    <div role="status" className="flex items-start gap-3 border-b border-brand/20 bg-brand/5 px-4 py-3 text-sm md:px-6">
      <ScrollText className="mt-0.5 size-4 shrink-0 text-brand" />
      <p className="text-foreground/90">
        <strong className="text-navy">{notice.title}</strong> — entra en vigor el{" "}
        {formatLongDate(notice.effectiveAt)}. {notice.body}{" "}
        <Link href={PROFESSIONAL_TERMS_PATH} className="underline hover:text-navy">
          Ver documentos
        </Link>
        . Si te resulta desfavorable, puedes terminar sin penalidad antes de esa fecha.
      </p>
    </div>
  );
}
