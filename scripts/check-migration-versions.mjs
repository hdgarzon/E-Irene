/**
 * Falla si la numeración de supabase/migrations rompería el `supabase db push`
 * del despliegue.
 *
 * POR QUÉ EXISTE
 *   `db push` no mira nombres de archivo: empareja cada migración con
 *   supabase_migrations.schema_migrations de producción solo por la versión, los
 *   dígitos antes del primer "_". Con varias ramas abiertas a la vez, dos PRs
 *   eligen el mismo número sin enterarse: el 14-sep-2026 la 0047 estaba en tres
 *   ramas y la 0048 y la 0049 en dos cada una.
 *
 *   Comprobado el 15-sep-2026 con el CLI que usa CI (2.117.0) contra una base
 *   descartable:
 *   · Misma versión y una ya aplicada: el push falla por la clave primaria de
 *     schema_migrations. `--dry-run` no lo detecta (sale 0). Si la nueva ordena
 *     antes que la aplicada, el CLI le asigna a ella la versión aplicada e
 *     intenta volver a correr la vieja.
 *   · Misma versión y ninguna aplicada: aplica la primera y falla en la segunda.
 *   · Versión menor que la última aplicada: falla sin aplicar nada, salvo con
 *     --include-all, que el despliegue no usa a propósito.
 *   · Nombre sin versión ("0050-algo.sql", "0050_algo.SQL"): la salta con un
 *     aviso y responde "Remote database is up to date".
 *   · Renumerar una migración ya aplicada: sale 0 sin correr nunca la que se
 *     quedó con la versión vieja, y vuelve a correr la renumerada con la nueva.
 *   Los tres primeros frenan el despliegue en la fase de migraciones; los dos
 *   últimos no fallan y dejan producción sin una migración que el código espera.
 *
 * QUÉ COMPRUEBA
 *   a) Que todo .sql tenga versión y que no haya dos archivos con la misma.
 *   b) Con --base: que cada migración que no está en la base tenga una versión
 *      mayor que la más alta de la base. Si main avanzó, se renumera la del PR,
 *      nunca una que ya esté en main (ver el último caso de arriba).
 *
 * Uso:
 *   node scripts/check-migration-versions.mjs
 *   git fetch origin main && node scripts/check-migration-versions.mjs --base origin/main
 *
 * En CI corre en el job `test` antes de instalar dependencias. En un
 * pull_request exige --base: sin la rama base, (b) no se evaluaría.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = "supabase/migrations";
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// El patrón con el que el CLI lee la versión (apps/cli-go/pkg/migration/file.go).
const MIGRATION_FILE = /^([0-9]+)_(.*)\.sql$/;

/**
 * @param {string} filename
 * @returns {string | null} La versión que lee `db push`, o null si no reconoce el nombre.
 */
export function migrationVersion(filename) {
  return MIGRATION_FILE.exec(filename)?.[1] ?? null;
}

/**
 * Archivos .sql que `db push` no reconoce como migración porque su nombre no trae versión.
 * @param {string[]} filenames
 * @returns {string[]}
 */
export function findUnversioned(filenames) {
  return [...filenames]
    .sort()
    .filter((name) => name.toLowerCase().endsWith(".sql") && migrationVersion(name) === null);
}

/**
 * Versiones que aparecen en más de un archivo.
 * @param {string[]} filenames
 * @returns {{ version: string, files: string[] }[]}
 */
export function findDuplicateVersions(filenames) {
  /** @type {Map<string, string[]>} */
  const byVersion = new Map();
  for (const name of [...filenames].sort()) {
    const version = migrationVersion(name);
    if (version !== null) byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
  }
  return [...byVersion]
    .filter(([, files]) => files.length > 1)
    .map(([version, files]) => ({ version, files }));
}

/**
 * La versión más alta. Se compara como texto, igual que el CLI; con el ancho fijo
 * de cuatro dígitos del repo coincide con el orden numérico.
 * @param {string[]} filenames
 * @returns {string | null}
 */
export function latestVersion(filenames) {
  /** @type {string | null} */
  let latest = null;
  for (const name of filenames) {
    const version = migrationVersion(name);
    if (version !== null && (latest === null || version > latest)) latest = version;
  }
  return latest;
}

/**
 * Migraciones que no están en la base y no van después de su última versión:
 * `db push` las rechazaría o chocarían con una ya aplicada.
 * @param {string[]} headFiles
 * @param {string[]} baseFiles
 * @returns {{ latest: string | null, files: string[] }}
 */
export function findNotAfterBase(headFiles, baseFiles) {
  const latest = latestVersion(baseFiles);
  const inBase = new Set(baseFiles);
  const files = [...headFiles].sort().filter((name) => {
    const version = migrationVersion(name);
    return latest !== null && version !== null && !inBase.has(name) && version <= latest;
  });
  return { latest, files };
}

/**
 * La versión que queda `step` lugares después de la más alta, con el mismo ancho.
 * @param {string[]} filenames
 * @param {number} [step]
 * @returns {string}
 */
function versionAfter(filenames, step = 1) {
  const latest = latestVersion(filenames) ?? "0000";
  return String(Number(latest) + step).padStart(latest.length, "0");
}

/**
 * Nombres nuevos para `files`, en orden y con versiones consecutivas después de la
 * más alta de `allFiles`.
 * @param {string[]} files
 * @param {string[]} allFiles
 * @returns {Map<string, string>}
 */
export function suggestRenames(files, allFiles) {
  return new Map(
    files.map((name, i) => [
      name,
      name.replace(MIGRATION_FILE, `${versionAfter(allFiles, i + 1)}_$2.sql`),
    ]),
  );
}

const IN_ACTIONS = process.env.GITHUB_ACTIONS === "true";

/** @param {string} text */
function escapeAnnotation(text) {
  return text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

/**
 * @param {string[]} problems
 * @returns {never}
 */
function fail(problems) {
  const count = problems.length === 1 ? "1 problema" : `${problems.length} problemas`;
  console.error(`Numeración de migraciones: ${count}.`);
  for (const problem of problems) {
    // En Actions sale además como anotación, visible en el resumen del PR sin abrir el log.
    console.error(
      IN_ACTIONS
        ? `::error title=Numeración de migraciones::${escapeAnnotation(problem)}`
        : `- ${problem}`,
    );
  }
  process.exit(1);
}

/**
 * @param {string[]} args
 * @returns {string | null}
 */
function parseBase(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--base" && args[1]) return args[1];
  if (args.length === 1 && args[0].startsWith("--base=") && args[0].length > "--base=".length) {
    return args[0].slice("--base=".length);
  }
  return fail([
    `Argumentos no reconocidos: ${args.join(" ")}. Uso: node scripts/check-migration-versions.mjs [--base <ref>]`,
  ]);
}

/** @returns {string[]} */
function readHeadMigrations() {
  return readdirSync(new URL(`../${MIGRATIONS_DIR}/`, import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

/**
 * @param {string} ref
 * @returns {string[]}
 */
function readBaseMigrations(ref) {
  try {
    const out = execFileSync("git", ["ls-tree", "--name-only", `${ref}:${MIGRATIONS_DIR}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split("\n").filter(Boolean).sort();
  } catch (error) {
    const detail = String(error?.stderr ?? "").trim() || String(error?.message ?? error);
    return fail([
      `No se pudo leer ${MIGRATIONS_DIR} en ${ref}: ${detail}. ` +
        "actions/checkout clona a profundidad 1: hay que traer la base antes, p. ej. " +
        "git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main",
    ]);
  }
}

/** @param {string[]} args */
function main(args) {
  const base = parseBase(args);
  if (base === null && process.env.GITHUB_EVENT_NAME === "pull_request") {
    fail([
      "En un pull_request hace falta --base <ref>: sin la rama base no se puede comprobar que las migraciones nuevas vayan después de las de main.",
    ]);
  }

  const head = readHeadMigrations();
  const baseFiles = base === null ? [] : readBaseMigrations(base);
  const problems = [];

  for (const name of findUnversioned(head)) {
    problems.push(
      `${name} no sigue el patrón <versión>_<nombre>.sql: supabase db push lo salta con solo un aviso y nunca lo aplica.`,
    );
  }

  for (const { version, files } of findDuplicateVersions(head)) {
    problems.push(
      `La versión ${version} está en ${files.join(", ")}. supabase db push empareja solo por versión: el despliegue fallaría al aplicarlas. ` +
        `Renumerar la que no se ha aplicado en producción (la siguiente versión libre es ${versionAfter([...head, ...baseFiles])}); ` +
        "nunca la ya aplicada, porque entonces db push se salta la otra sin fallar.",
    );
  }

  if (base !== null) {
    const { latest, files } = findNotAfterBase(head, baseFiles);
    const renames = suggestRenames(files, [...head, ...baseFiles]);
    for (const name of files) {
      problems.push(
        `${name} no está en ${base} y su versión (${migrationVersion(name)}) no es mayor que la última de ${base} (${latest}): ` +
          `${base} avanzó y db push la rechazaría o chocaría con una ya aplicada. Renombrarla a ${renames.get(name)}.`,
      );
    }
  }

  if (problems.length > 0) fail(problems);

  const versioned = head.filter((name) => migrationVersion(name) !== null);
  let summary = `${versioned.length} migraciones, sin versiones repetidas; la última es ${latestVersion(head)}`;
  if (base !== null) {
    const inBase = new Set(baseFiles);
    const added = versioned.filter((name) => !inBase.has(name));
    const baseLatest = latestVersion(baseFiles);
    summary +=
      added.length === 0
        ? `; ninguna nueva respecto de ${base} (su última es ${baseLatest})`
        : `; nuevas respecto de ${base}, todas después de ${baseLatest}: ${added.join(", ")}`;
  }
  console.log(`Numeración de migraciones OK: ${summary}.`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
