import { describe, it, expect } from "vitest";
import { supabaseConnectSources } from "@/lib/csp";

describe("CSP: orígenes de Supabase en connect-src", () => {
  it("en local agrega exactamente el Supabase de desarrollo y su WebSocket", () => {
    expect(supabaseConnectSources("http://127.0.0.1:54321")).toEqual([
      "http://127.0.0.1:54321",
      "ws://127.0.0.1:54321",
    ]);
  });

  it("en producción agrega el proyecto configurado con https y wss", () => {
    expect(supabaseConnectSources("https://abcdefghijklmnop.supabase.co")).toEqual([
      "https://abcdefghijklmnop.supabase.co",
      "wss://abcdefghijklmnop.supabase.co",
    ]);
  });

  it("agrega solo el origen, sin la ruta de la URL", () => {
    expect(supabaseConnectSources("http://localhost:54321/")).toEqual([
      "http://localhost:54321",
      "ws://localhost:54321",
    ]);
  });

  it("sin URL, con una inválida o con otro esquema no agrega nada: nunca un comodín", () => {
    expect(supabaseConnectSources(undefined)).toEqual([]);
    expect(supabaseConnectSources("no es una url")).toEqual([]);
    expect(supabaseConnectSources("javascript:alert(1)")).toEqual([]);
  });
});
