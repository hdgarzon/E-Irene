import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  acquireSupabaseLock,
  isProcessAlive,
  releaseSupabaseLock,
  supabaseLockPath,
  type LockHolder,
} from "./helpers/supabase-lock";

/**
 * Candado de máquina sobre el Supabase local (tests/helpers/supabase-lock.ts).
 * Sin stack: cada prueba usa su propio directorio, pids inventados y un reloj
 * falso, así que no espera de verdad ni choca con el candado de esta corrida.
 */

const STACK = "http://127.0.0.1:54321";
const MI_PID = 1111;
const OTRO_PID = 2222;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e-irene-candado-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Deja el candado tomado por otra corrida. */
function ocupadoPorOtra(): string {
  const path = supabaseLockPath(STACK, dir);
  const holder: LockHolder = {
    pid: OTRO_PID,
    cwd: "/worktrees/otro",
    startedAt: "2026-09-15T14:00:00.000Z",
  };
  writeFileSync(path, JSON.stringify(holder));
  return path;
}

function holderEn(path: string): LockHolder {
  return JSON.parse(readFileSync(path, "utf8")) as LockHolder;
}

/** Reloj falso: `sleep` avanza el tiempo sin esperar. */
function relojFalso() {
  let t = Date.now();
  const esperas: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      esperas.push(ms);
      t += ms;
    },
    esperas,
  };
}

async function mensajeDeError(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("se esperaba que fallara");
}

describe("supabaseLockPath", () => {
  it("el mismo stack comparte candado aunque cambie el host local o la barra final", () => {
    const path = supabaseLockPath(STACK, dir);
    expect(supabaseLockPath("http://localhost:54321/", dir)).toBe(path);
    expect(supabaseLockPath("http://[::1]:54321", dir)).toBe(path);
    expect(dirname(path)).toBe(dir);
  });

  it("otro puerto es otro stack y otro candado", () => {
    expect(supabaseLockPath("http://127.0.0.1:54322", dir)).not.toBe(supabaseLockPath(STACK, dir));
  });
});

describe("isProcessAlive", () => {
  it("distingue un proceso vivo de uno que ya terminó", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    const terminado = spawnSync(process.execPath, ["-e", ""]);
    expect(isProcessAlive(terminado.pid)).toBe(false);
  });
});

describe("acquireSupabaseLock", () => {
  it("libre: lo toma, deja escrito quién lo tiene y lo suelta", async () => {
    const lock = await acquireSupabaseLock(STACK, { dir, pid: MI_PID, cwd: "/worktrees/este" });

    expect(lock.waited).toBe(false);
    const holder = holderEn(lock.path);
    expect(holder.pid).toBe(MI_PID);
    expect(holder.cwd).toBe("/worktrees/este");
    expect(Number.isNaN(Date.parse(holder.startedAt))).toBe(false);

    lock.release();
    expect(existsSync(lock.path)).toBe(false);
  });

  it("ocupado por una corrida viva: pasado el tope falla diciendo quién lo tiene, sin tocarlo", async () => {
    const path = ocupadoPorOtra();

    const mensaje = await mensajeDeError(
      acquireSupabaseLock(STACK, {
        dir,
        pid: MI_PID,
        timeoutMs: 0,
        isAlive: () => true,
        log: () => {},
      }),
    );

    expect(mensaje).toContain(`pid ${OTRO_PID} en /worktrees/otro`);
    expect(mensaje).toContain(`rm "${path}"`);
    expect(mensaje).toContain("No se corrió ninguna prueba");
    expect(holderEn(path).pid).toBe(OTRO_PID);
  });

  it("espera a que la otra corrida lo suelte, avisando quién lo tiene", async () => {
    const path = ocupadoPorOtra();
    const reloj = relojFalso();
    const avisos: string[] = [];

    const lock = await acquireSupabaseLock(STACK, {
      dir,
      pid: MI_PID,
      pollMs: 1_000,
      noticeEveryMs: 30_000,
      isAlive: () => true,
      now: reloj.now,
      sleep: async (ms) => {
        await reloj.sleep(ms);
        // La otra corrida termina a los 3 s.
        if (reloj.esperas.length === 3) rmSync(path);
      },
      log: (m) => avisos.push(m),
    });

    expect(lock.waited).toBe(true);
    expect(holderEn(lock.path).pid).toBe(MI_PID);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain(`pid ${OTRO_PID} en /worktrees/otro`);
  });

  it("no espera más que el tope y sigue avisando mientras tanto", async () => {
    ocupadoPorOtra();
    const reloj = relojFalso();
    const avisos: string[] = [];

    const mensaje = await mensajeDeError(
      acquireSupabaseLock(STACK, {
        dir,
        pid: MI_PID,
        timeoutMs: 10 * 60_000,
        pollMs: 1_000,
        noticeEveryMs: 30_000,
        isAlive: () => true,
        now: reloj.now,
        sleep: reloj.sleep,
        log: (m) => avisos.push(m),
      }),
    );

    expect(mensaje).toContain("tras 10 min de espera");
    expect(reloj.esperas.reduce((a, b) => a + b, 0)).toBe(10 * 60_000);
    // Un aviso cada 30 s: que se vea que sigue esperando, sin inundar la salida.
    expect(avisos).toHaveLength(20);
  });

  it("reemplaza un candado cuyo proceso ya no existe: una corrida matada no llega a soltarlo", async () => {
    ocupadoPorOtra();

    const lock = await acquireSupabaseLock(STACK, {
      dir,
      pid: MI_PID,
      timeoutMs: 0,
      isAlive: (pid) => pid !== OTRO_PID,
    });

    expect(lock.waited).toBe(false);
    expect(holderEn(lock.path).pid).toBe(MI_PID);
  });

  it("no se espera a sí mismo: una re-ejecución que no llegó a soltarlo lo conserva", async () => {
    const primero = await acquireSupabaseLock(STACK, { dir, pid: MI_PID });

    const segundo = await acquireSupabaseLock(STACK, {
      dir,
      pid: MI_PID,
      timeoutMs: 0,
      isAlive: () => true,
    });

    expect(segundo.waited).toBe(false);
    expect(holderEn(primero.path).pid).toBe(MI_PID);
  });

  it("respeta un candado ilegible recién creado: la otra corrida puede estar escribiéndolo", async () => {
    const path = supabaseLockPath(STACK, dir);
    writeFileSync(path, "");

    const mensaje = await mensajeDeError(
      acquireSupabaseLock(STACK, { dir, pid: MI_PID, timeoutMs: 0, log: () => {} }),
    );

    expect(mensaje).toContain("todavía sin datos de quién lo tiene");
    expect(readFileSync(path, "utf8")).toBe("");
  });

  it("da por abandonado un candado ilegible y viejo", async () => {
    const path = supabaseLockPath(STACK, dir);
    writeFileSync(path, "{");
    const haceUnMinuto = new Date(Date.now() - 60_000);
    utimesSync(path, haceUnMinuto, haceUnMinuto);

    const lock = await acquireSupabaseLock(STACK, { dir, pid: MI_PID, timeoutMs: 0 });

    expect(holderEn(lock.path).pid).toBe(MI_PID);
  });
});

describe("releaseSupabaseLock", () => {
  it("no borra el candado de otra corrida", () => {
    const path = ocupadoPorOtra();
    releaseSupabaseLock(path, MI_PID);
    expect(holderEn(path).pid).toBe(OTRO_PID);
  });

  it("sin candado no hace nada", () => {
    expect(() => releaseSupabaseLock(join(dir, "no-existe.lock"), MI_PID)).not.toThrow();
  });
});
