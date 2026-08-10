import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/cron/purge-documents/route";
import { DOCUMENT_RETENTION_DAYS } from "@/lib/db/verification-documents";

function req(token?: string): Request {
  return new Request("https://e-irene.co/api/cron/purge-documents", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("plazo de retención de documentos de identidad", () => {
  it("son 30 días desde la decisión", () => {
    // Si cambia, hay que cambiar también la política de tratamiento publicada:
    // los dos textos deben decir lo mismo.
    expect(DOCUMENT_RETENTION_DAYS).toBe(30);
  });
});

/**
 * El cron de facturación ya tuvo una vez el bug de responder solo a POST
 * cuando Vercel invoca por GET, y falló en silencio sin reintento. Estas
 * pruebas fijan el contrato del endpoint para que no se repita.
 */
describe("endpoint de cron: autorización", () => {
  const original = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "secreto-de-prueba";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("sin CRON_SECRET configurado responde 503 y no ejecuta nada", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("lo-que-sea"));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "not_configured" });
  });

  it("sin cabecera de autorización responde 401", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("con un token equivocado responde 401", async () => {
    const res = await GET(req("token-incorrecto"));
    expect(res.status).toBe(401);
  });

  it("responde a GET: es el único verbo que usa Vercel Cron", () => {
    expect(typeof GET).toBe("function");
  });
});
