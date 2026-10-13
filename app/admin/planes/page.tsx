import Link from "next/link";
import { PLANS, PLAN_ORDER, TRANSCRIPTION_PACK, VAT_NOTE, VIDEO_CALL_PRICE_IN_CENTS, formatCop, planFeatures } from "@/lib/plans";

/**
 * Planes vigentes, de solo lectura. Antes esta pantalla editaba título y precio
 * en plan_configs, pero nada leía esa tabla: el precio que se publica y el que
 * Wompi cobra salen de lib/plans.ts. Editar aquí no cambiaba nada y hacía creer
 * lo contrario.
 */
export default function AdminPlanesPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Planes</h1>
        <p className="text-sm text-muted-foreground">
          Planes y precios vigentes ({VAT_NOTE.toLowerCase()}). Son los que se publican en{" "}
          <Link href="/#planes" className="text-primary hover:underline">
            e-irene.co/#planes
          </Link>{" "}
          y los que cobra Wompi: salen de <code>lib/plans.ts</code>.
        </p>
      </div>

      <section className="space-y-2 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5 text-sm">
        <p className="font-medium text-navy">Para cambiar un precio o un límite</p>
        <ol className="list-decimal space-y-1 pl-5 text-foreground/90">
          <li>
            Publica el aviso en{" "}
            <Link href="/admin/avisos" className="text-primary hover:underline">
              Avisos legales
            </Link>{" "}
            con al menos 15 días hábiles de antelación y envíalo por correo (Términos de Vinculación,
            cláusula décima).
          </li>
          <li>
            Cambia <code>lib/plans.ts</code> en un PR y fusiónalo <strong>el día de la vigencia</strong>, no
            antes: el precio nuevo se cobra desde la siguiente renovación y nunca sobre períodos ya
            pagados.
          </li>
        </ol>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {PLAN_ORDER.map((plan) => {
          const p = PLANS[plan];
          return (
            <div key={plan} className="rounded-2xl border border-gray-line bg-card p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-heading font-semibold text-navy">{p.label}</h2>
                <span className="text-sm font-medium text-brand">{p.price}</span>
              </div>
              <p className="font-mono text-xs text-muted-foreground">{plan}</p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {planFeatures(plan).map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        Adicionales: {TRANSCRIPTION_PACK.hours} h de transcripción por{" "}
        {formatCop(TRANSCRIPTION_PACK.priceInCents)} COP; videollamadas a {formatCop(VIDEO_CALL_PRICE_IN_CENTS)} COP
        cada una.
      </p>
    </div>
  );
}
