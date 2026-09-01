/**
 * Auditoría del opt-out del Model Improvement Program de Deepgram.
 *
 * Responde con datos, no con confianza en el código: consulta las peticiones
 * reales que llegaron a la cuenta y reporta cuáles llevaban `mip_opt_out=true`
 * y cuáles no. Las que no lo llevaban entraron al programa de mejora de
 * modelos, es decir, su audio quedó retenido para entrenamiento.
 *
 *   set -a && . ./.env.local && set +a && node scripts/audit-deepgram-mip.mjs
 *
 * Requiere DEEPGRAM_API_KEY con permisos de lectura del proyecto. Solo hace
 * peticiones GET: no modifica nada.
 */

const KEY = process.env.DEEPGRAM_API_KEY;
if (!KEY) {
  console.error("Falta DEEPGRAM_API_KEY.");
  process.exit(1);
}

const auth = { Authorization: `Token ${KEY}` };

async function get(url) {
  const res = await fetch(url, { headers: auth });
  if (!res.ok) throw new Error(`Deepgram respondió ${res.status} en ${url}`);
  return res.json();
}

const { projects } = await get("https://api.deepgram.com/v1/projects");
const project = projects[0];
if (!project) {
  console.error("La cuenta no tiene proyectos.");
  process.exit(1);
}

// La API rechaza limit>100 con 400, así que se pagina hasta agotar.
const PAGE_SIZE = 100;
const requests = [];
for (let page = 0; ; page += 1) {
  const { requests: lote = [] } = await get(
    `https://api.deepgram.com/v1/projects/${project.project_id}/requests` +
      `?limit=${PAGE_SIZE}&page=${page}`,
  );
  requests.push(...lote);
  if (lote.length < PAGE_SIZE) break;
}

const protegidas = [];
const expuestas = [];
for (const r of requests) {
  (String(r.path ?? "").includes("mip_opt_out=true") ? protegidas : expuestas).push(r);
}

const minutos = (rs) =>
  rs.reduce((t, r) => t + Number(r?.response?.details?.duration ?? 0), 0) / 60;
const rango = (rs) => {
  const f = rs.map((r) => String(r.created ?? "").slice(0, 10)).sort();
  return f.length ? `${f[0]} → ${f[f.length - 1]}` : "—";
};

console.log(`Proyecto Deepgram : ${project.name ?? project.project_id}`);
console.log(`Peticiones totales: ${requests.length}`);
console.log("");
console.log(`✅ CON opt-out : ${protegidas.length}  (${minutos(protegidas).toFixed(1)} min)  ${rango(protegidas)}`);
console.log(`❌ SIN opt-out : ${expuestas.length}  (${minutos(expuestas).toFixed(1)} min)  ${rango(expuestas)}`);

if (expuestas.length > 0) {
  console.log("");
  console.log("Las peticiones SIN opt-out entraron al Model Improvement Program:");
  console.log("su audio quedó retenido por Deepgram para entrenar modelos.");
  console.log("Solicitar su borrado a support@deepgram.com citando estos request_id:");
  for (const r of expuestas.slice(0, 30)) {
    console.log(`  ${String(r.created).slice(0, 19)}  ${r.request_id}`);
  }
  if (expuestas.length > 30) console.log(`  … y ${expuestas.length - 30} más`);
  process.exitCode = 1; // falla en CI si alguna petición quedó expuesta
}
