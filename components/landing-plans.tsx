import Link from "next/link";
import {
  PLANS,
  PLAN_ORDER,
  TRANSCRIPTION_PACK,
  VIDEO_CALL_PRICE_IN_CENTS,
  VIDEO_PACK_SIZES,
  formatCop,
  planFeatures,
} from "@/lib/plans";
import { PROFESSIONAL_TERMS_PATH } from "@/lib/legal-documents/urls";

const label = {
  fontFamily: "var(--font-landing-sans)",
  fontSize: 12,
  fontWeight: 300,
  letterSpacing: "3px",
  textTransform: "uppercase" as const,
  color: "#46617d",
  opacity: 0.7,
};

const small = {
  fontFamily: "var(--font-landing-sans)",
  fontWeight: 300,
  fontSize: 13,
  lineHeight: 1.6,
  color: "#46617d",
};

/**
 * Planes y precios publicados (e-irene.co/#planes). Los Términos y Condiciones
 * (cláusula undécima) y los de Vinculación (cláusula duodécima) remiten a esta
 * URL como la fuente de los precios vigentes, así que todo sale de lib/plans.ts
 * —el mismo valor que se cobra por Wompi—, nunca de cifras escritas aquí.
 */
export function LandingPlans() {
  return (
    <section id="planes" style={{ padding: "150px 5vw 80px", background: "#f7fafc", position: "relative", zIndex: 2 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div className="mb-6" style={label}>
          Planes y precios
        </div>
        <div className="mb-16" style={{ width: "100%", height: 1, background: "rgba(18, 40, 63, 0.12)" }} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" style={{ gap: 0 }}>
          {PLAN_ORDER.map((plan) => {
            const p = PLANS[plan];
            const price =
              p.priceInCents === null ? "A convenir" : p.priceInCents === 0 ? "Gratis" : formatCop(p.priceInCents);
            return (
              <div
                key={plan}
                style={{ borderBottom: "1px solid rgba(18, 40, 63, 0.1)", padding: "28px 20px" }}
                className="lg:border-r lg:border-[rgba(18,40,63,0.1)] lg:last:border-r-0"
              >
                <h3
                  style={{
                    fontFamily: "var(--font-landing-serif)",
                    fontWeight: 400,
                    fontSize: 28,
                    color: "#12283f",
                  }}
                >
                  {p.label}
                </h3>
                <p style={{ fontFamily: "var(--font-landing-sans)", fontSize: 22, fontWeight: 400, color: "#12283f", marginTop: 8 }}>
                  {price}
                  {p.priceInCents !== null && p.priceInCents > 0 && (
                    <span style={{ ...small, fontSize: 12 }}> COP/mes</span>
                  )}
                </p>
                <ul style={{ ...small, marginTop: 16 }} className="space-y-1.5">
                  {planFeatures(plan).map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: 40, marginTop: 48 }}>
          <div style={small}>
            <p style={{ color: "#12283f", fontWeight: 400 }}>Adicionales</p>
            <p>
              Horas de transcripción: {TRANSCRIPTION_PACK.hours} h por{" "}
              {formatCop(TRANSCRIPTION_PACK.priceInCents)} COP. Vencen al terminar el período de
              facturación en que se compran.
            </p>
            <p style={{ marginTop: 8 }}>
              Videollamadas: {formatCop(VIDEO_CALL_PRICE_IN_CENTS)} COP cada una, en paquetes de{" "}
              {VIDEO_PACK_SIZES.join(", ").replace(/, (\d+)$/, " o $1")}. Los paquetes no vencen y se
              conservan mientras la cuenta exista: si eliminas la cuenta, las videollamadas no usadas
              se pierden y no se reembolsan.
            </p>
          </div>
          <div style={small}>
            <p style={{ color: "#12283f", fontWeight: 400 }}>Condiciones</p>
            <p>
              Precios en pesos colombianos. Los planes pagos son mensuales, sin permanencia, y se
              renuevan automáticamente hasta que los canceles. Las condiciones de suscripción,
              cambios de plan, compras adicionales, cancelación y reembolsos están en la cláusula
              duodécima de los{" "}
              <Link href={PROFESSIONAL_TERMS_PATH} className="landing-nav-link" style={{ display: "inline" }}>
                Términos de Vinculación del Profesional
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
