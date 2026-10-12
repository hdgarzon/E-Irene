import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getMarketingOptIn, listMyAcceptances } from "@/lib/db/policy-acceptances";
import { MARKETING_OPT_IN_TEXT } from "@/lib/legal-documents/acceptance";
import { POLICY_PATH, PROFESSIONAL_TERMS_PATH, TERMS_OF_USE_PATH, DATA_PROTECTION_EMAIL } from "@/lib/legal-documents/urls";
import { formatLongDate, formatTime } from "@/lib/dates";
import { MarketingPreferenceForm } from "@/components/marketing-preference-form";

/**
 * Mi cuenta: las autorizaciones del propio usuario. La comercial se puede
 * retirar en cualquier momento (Términos de Vinculación, cláusula novena), y el
 * historial de aceptaciones es la prueba que el usuario puede pedir (Política,
 * sección 6, numeral 2).
 */
export default async function CuentaPage() {
  const user = await requireUser();
  const [optedIn, acceptances] = await Promise.all([
    getMarketingOptIn(user.id),
    listMyAcceptances(user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-navy">Mi cuenta</h1>
        <p className="text-sm text-muted-foreground">
          {user.fullName} · {user.email}
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-gray-line bg-card p-5 md:p-6">
        <h2 className="font-semibold text-navy">Comunicaciones comerciales</h2>
        <p className="text-sm text-muted-foreground">
          &ldquo;{MARKETING_OPT_IN_TEXT}&rdquo; — Estado actual:{" "}
          <strong className="text-navy">{optedIn ? "autorizadas" : "no autorizadas"}</strong>. Es
          opcional y puedes cambiarlo cuando quieras; no afecta los avisos operativos de tu cuenta.
        </p>
        <MarketingPreferenceForm optedIn={optedIn} />
      </section>

      <section className="space-y-3 rounded-2xl border border-gray-line bg-card p-5 md:p-6">
        <h2 className="font-semibold text-navy">Documentos aceptados</h2>
        <p className="text-sm text-muted-foreground">
          Cada aceptación queda registrada con la versión y la huella del texto aceptado:{" "}
          <Link href={PROFESSIONAL_TERMS_PATH} className="text-primary hover:underline">Términos de Vinculación</Link>,{" "}
          <Link href={TERMS_OF_USE_PATH} className="text-primary hover:underline">Términos y Condiciones</Link> y{" "}
          <Link href={POLICY_PATH} className="text-primary hover:underline">Política de Tratamiento</Link>.
          Para ejercer tus derechos sobre tus datos escribe a {DATA_PROTECTION_EMAIL}.
        </p>
        {acceptances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin aceptaciones registradas.</p>
        ) : (
          <ul className="divide-y divide-gray-line text-sm">
            {acceptances.map((a) => (
              <li key={`${a.acceptedAt}-${a.documentHash}`} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  Versión {a.documentVersion} · {formatLongDate(a.acceptedAt)}, {formatTime(a.acceptedAt)}
                </span>
                <span className="text-muted-foreground">
                  Comunicaciones: {a.marketingOptIn ? "sí" : "no"} ·{" "}
                  <span className="font-mono text-xs">{a.documentHash.slice(0, 12)}…</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
