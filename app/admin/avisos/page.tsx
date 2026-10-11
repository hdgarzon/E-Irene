import { listLegalNotices } from "@/lib/db/legal-notices";
import { earliestEffectiveDate } from "@/lib/legal-notices";
import { formatLongDate, formatTime } from "@/lib/dates";
import { LegalNoticeForm } from "@/components/legal-notice-form";
import { Button } from "@/components/ui/button";
import { emailLegalNoticeAction } from "./actions";

/**
 * Avisos de cambios legales (Política de Tratamiento, sección 10; Términos de
 * Vinculación, cláusula décima): 15 días hábiles de antelación, en la
 * plataforma y por correo. El paso de subir la versión de los documentos sigue
 * siendo un cambio de código (lib/legal.ts), el día de la vigencia.
 */
export default async function AdminAvisosPage() {
  const notices = await listLegalNotices();
  const now = new Date().toISOString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Avisos de cambios legales</h1>
        <p className="text-sm text-muted-foreground">
          Antes de cambiar la Política, los Términos o el consentimiento, avisa aquí con al menos 15
          días hábiles. El aviso se muestra en la app a todo el personal hasta su vigencia y se envía
          una vez por correo; queda la constancia de cuándo y a cuántos.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <LegalNoticeForm minDate={earliestEffectiveDate()} />
      </div>

      <div className="space-y-3">
        {notices.map((n) => (
          <article key={n.id} className="space-y-2 rounded-2xl border border-gray-line bg-card p-5 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium text-navy">{n.title}</p>
              <p className="text-xs text-muted-foreground">
                {n.effectiveAt > now ? "Entra en vigor el " : "Vigente desde el "}
                {formatLongDate(n.effectiveAt)}
              </p>
            </div>
            <p className="whitespace-pre-wrap text-muted-foreground">{n.body}</p>
            {n.emailedAt ? (
              <p className="text-xs text-mint">
                Enviado por correo el {formatLongDate(n.emailedAt)}, {formatTime(n.emailedAt)} a{" "}
                {n.emailedCount} destinatarios.
              </p>
            ) : (
              <form action={emailLegalNoticeAction.bind(null, n.id)}>
                <Button type="submit" size="sm" variant="outline">
                  Enviar por correo a todo el personal
                </Button>
              </form>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
