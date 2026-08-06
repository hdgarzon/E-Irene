import { describe, it, expect, afterEach } from "vitest";
import { appBaseUrl } from "@/lib/app-url";

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
});

describe("appBaseUrl", () => {
  it("devuelve el origen tal cual cuando la variable está bien configurada", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://e-irene.co";
    expect(appBaseUrl()).toBe("https://e-irene.co");
  });

  it("descarta ruta y query pegadas por error a la variable", () => {
    // Valor real que llegó a producción (2026-08-06) y generaba URLs
    // duplicadas: "https://e-irene.co/settings/plan?wompi=return/enlace/<token>"
    // en los links de consentimiento/PHQ-9 enviados a pacientes.
    process.env.NEXT_PUBLIC_APP_URL = "https://e-irene.co/settings/plan?wompi=return";
    expect(appBaseUrl()).toBe("https://e-irene.co");
  });

  it("quita la barra final para no producir dobles barras al concatenar", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://e-irene.co/";
    expect(appBaseUrl()).toBe("https://e-irene.co");
  });

  it("conserva el puerto en entornos de desarrollo", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(appBaseUrl()).toBe("http://localhost:3000");
  });

  it("cae al dominio conocido si la variable no es una URL válida", () => {
    process.env.NEXT_PUBLIC_APP_URL = "e-irene.co (sin protocolo)";
    expect(appBaseUrl()).toBe("https://e-irene.co");
  });

  it("cae al dominio conocido si la variable está vacía o ausente", () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    expect(appBaseUrl()).toBe("https://e-irene.co");
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appBaseUrl()).toBe("https://e-irene.co");
  });
});
