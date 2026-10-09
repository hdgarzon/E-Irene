import Link from "next/link";
import { MARKETING_OPT_IN_TEXT, PROFESSIONAL_ACCEPTANCE_TEXT } from "@/lib/legal-documents/acceptance";
import { POLICY_PATH, PROFESSIONAL_TERMS_PATH, TERMS_OF_USE_PATH } from "@/lib/legal-documents/urls";

const DOCUMENT_LINKS = [
  { href: PROFESSIONAL_TERMS_PATH, label: "Términos de Vinculación del Profesional" },
  { href: TERMS_OF_USE_PATH, label: "Términos y Condiciones de Uso" },
  { href: POLICY_PATH, label: "Política de Tratamiento de Datos Personales" },
];

/**
 * Casillas de la Pieza 2: la declaración y aceptación (obligatoria) y la
 * autorización comercial (separada y opcional). Ninguna premarcada: una casilla
 * marcada por defecto no constituye autorización válida bajo la Ley 1581.
 *
 * El texto de la casilla obligatoria se muestra tal cual se hashea
 * (PROFESSIONAL_ACCEPTANCE_TEXT); los documentos que cita van enlazados debajo.
 */
export function ProfessionalAcceptanceFields() {
  return (
    <div className="space-y-3 text-left">
      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-line p-4 transition-colors hover:bg-cloud">
        <input type="checkbox" name="accepted" required className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span className="text-sm leading-relaxed">{PROFESSIONAL_ACCEPTANCE_TEXT}</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Léelos antes de aceptar:{" "}
        {DOCUMENT_LINKS.map((d, i) => (
          <span key={d.href}>
            {i > 0 && " · "}
            <Link href={d.href} target="_blank" className="text-primary hover:underline">
              {d.label}
            </Link>
          </span>
        ))}
        .
      </p>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-line p-4 transition-colors hover:bg-cloud">
        <input type="checkbox" name="marketing" className="mt-0.5 size-4 shrink-0 accent-primary" />
        <span className="text-sm">
          {MARKETING_OPT_IN_TEXT}
          <span className="block text-xs text-muted-foreground">
            Opcional. Puedes retirar esta autorización en cualquier momento.
          </span>
        </span>
      </label>
    </div>
  );
}
