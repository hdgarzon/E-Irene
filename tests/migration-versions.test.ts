import { describe, it, expect } from "vitest";
import {
  findDuplicateVersions,
  findNotAfterBase,
  findUnversioned,
  latestVersion,
  migrationVersion,
  suggestRenames,
} from "@/scripts/check-migration-versions.mjs";

// Los casos reproducen las colisiones del 14-sep-2026 entre ramas abiertas en
// paralelo: por qué importan está en la cabecera del script.
const MAIN = ["0045_phq9_risk_evaluation.sql", "0046_risk_alerts_write_guard.sql"];

describe("migrationVersion", () => {
  it("lee los dígitos antes del primer guion bajo, como supabase db push", () => {
    expect(migrationVersion("0047_risk_alerts_insert_guard.sql")).toBe("0047");
    expect(migrationVersion("20260915120000_con_timestamp.sql")).toBe("20260915120000");
  });

  it("devuelve null para lo que el CLI no reconoce como migración", () => {
    expect(migrationVersion("0047-con-guion.sql")).toBeNull();
    expect(migrationVersion("0047_mayusculas.SQL")).toBeNull();
    expect(migrationVersion("sin_version.sql")).toBeNull();
  });
});

describe("findUnversioned", () => {
  it("señala los .sql sin versión e ignora lo que no es SQL", () => {
    expect(findUnversioned([...MAIN, "0047-con-guion.sql", "0048_x.SQL", "README.md"])).toEqual([
      "0047-con-guion.sql",
      "0048_x.SQL",
    ]);
  });
});

describe("findDuplicateVersions", () => {
  it("no encuentra nada si cada versión tiene un solo archivo", () => {
    expect(findDuplicateVersions([...MAIN, "0047_risk_alerts_insert_guard.sql"])).toEqual([]);
  });

  it("agrupa los archivos que comparten versión aunque el nombre sea distinto", () => {
    const files = [
      ...MAIN,
      "0047_risk_alerts_insert_guard.sql",
      "0047_platform_admin_bounded_rpcs.sql",
    ];
    expect(findDuplicateVersions(files)).toEqual([
      {
        version: "0047",
        files: ["0047_platform_admin_bounded_rpcs.sql", "0047_risk_alerts_insert_guard.sql"],
      },
    ]);
  });
});

describe("latestVersion", () => {
  it("devuelve la versión más alta sin importar el orden de entrada", () => {
    expect(latestVersion(["0046_b.sql", "0047_c.sql", "0045_a.sql"])).toBe("0047");
  });

  it("devuelve null si no hay migraciones", () => {
    expect(latestVersion([])).toBeNull();
  });
});

describe("findNotAfterBase", () => {
  it("acepta las migraciones nuevas posteriores a la última de la base", () => {
    const head = [...MAIN, "0047_risk_alerts_insert_guard.sql"];
    expect(findNotAfterBase(head, MAIN)).toEqual({ latest: "0046", files: [] });
  });

  it("rechaza una nueva con la misma versión que otra que ya llegó a la base", () => {
    const base = [...MAIN, "0047_risk_alerts_insert_guard.sql"];
    const head = [...base, "0047_platform_admin_bounded_rpcs.sql"];
    expect(findNotAfterBase(head, base)).toEqual({
      latest: "0047",
      files: ["0047_platform_admin_bounded_rpcs.sql"],
    });
  });

  it("rechaza una nueva que quedó por debajo de la última de la base aunque no choque", () => {
    const base = [...MAIN, "0048_clinic_reference_guards.sql"];
    const head = [...base, "0047_risk_alerts_insert_guard.sql"];
    expect(findNotAfterBase(head, base).files).toEqual(["0047_risk_alerts_insert_guard.sql"]);
  });

  it("no juzga las migraciones que ya están en la base", () => {
    expect(findNotAfterBase(MAIN, MAIN).files).toEqual([]);
  });
});

describe("suggestRenames", () => {
  it("propone versiones consecutivas después de la más alta, con el mismo ancho", () => {
    const all = [...MAIN, "0049_clinic_plan_esencial.sql", "0047_a.sql", "0048_b.sql"];
    expect(suggestRenames(["0047_a.sql", "0048_b.sql"], all)).toEqual(
      new Map([
        ["0047_a.sql", "0050_a.sql"],
        ["0048_b.sql", "0051_b.sql"],
      ]),
    );
  });
});
