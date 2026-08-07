import { describe, it, expect } from "vitest";
import { extractPaymentLinkId } from "@/lib/db/billing-checkouts";

describe("extractPaymentLinkId", () => {
  it("extrae el id de una referencia REAL generada por Wompi (sandbox)", () => {
    // Referencia observada en producción el 2026-08-07, para el payment link
    // "test_DycgWj". Wompi descarta la referencia que enviamos y arma la suya
    // con este formato — de ahí que haga falta extraer el id.
    expect(extractPaymentLinkId("test_DycgWj_1786079615_Tc7H27rmL")).toBe("test_DycgWj");
  });

  it("funciona con ids de producción (sin el prefijo test_)", () => {
    expect(extractPaymentLinkId("DycgWj_1786079615_Tc7H27rmL")).toBe("DycgWj");
  });

  it("soporta ids con varios guiones bajos", () => {
    expect(extractPaymentLinkId("test_abc_def_1786079615_Tc7H27rmL")).toBe("test_abc_def");
  });

  it("devuelve null si la referencia no tiene el formato esperado", () => {
    // Comportamiento seguro: sin id no se resuelve ninguna clínica, y el pago
    // se descarta en vez de asignarse a la equivocada.
    expect(extractPaymentLinkId("planupgrade-algo")).toBeNull();
    expect(extractPaymentLinkId("solo_dos")).toBeNull();
    expect(extractPaymentLinkId("")).toBeNull();
  });
});
