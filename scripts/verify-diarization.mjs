/**
 * Verifica que Deepgram con diarize=true distingue hablantes reales usando
 * un audio de dos voces distintas (simulando doctor/paciente). No forma
 * parte de la suite CI — es una utilidad de diagnóstico manual.
 *
 * Para regenerar /tmp/dg-dialog.wav (macOS, dos voces + silencios entre
 * turnos, 16kHz/16-bit/mono — nota: `afconvert -d LEI16@16000`, NO `-r`,
 * que es calidad del resampler, no la tasa de muestreo):
 *
 *   say -v Daniel "Hola, cómo te has sentido esta semana?" -o /tmp/d1.aiff
 *   say -v Mónica "Me he sentido ansiosa por el trabajo." -o /tmp/p1.aiff
 *   afconvert /tmp/d1.aiff /tmp/d1.wav -d LEI16@16000 -f WAVE -c 1
 *   afconvert /tmp/p1.aiff /tmp/p1.wav -d LEI16@16000 -f WAVE -c 1
 *   # concatenar con node:wave o python "wave" module + silencio entre turnos
 */
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const DEEPGRAM_KEY = env.match(/^DEEPGRAM_API_KEY=(.+)$/m)?.[1];
const PROJECT_ID = "105aefe1-8154-4eb8-be3d-71b4d5f8731b";
const WAV_PATH = "/tmp/dg-dialog.wav";

const keyRes = await fetch(`https://api.deepgram.com/v1/projects/${PROJECT_ID}/keys`, {
  method: "POST",
  headers: { Authorization: `Token ${DEEPGRAM_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ comment: "e-irene-diarize-test", scopes: ["usage:write"], time_to_live_in_seconds: 120 }),
});
const { key: ephemeralKey } = await keyRes.json();
console.log("Key efímera OK ✓");

const WS_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=es&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=true&punctuate=true&diarize=true";

const ws = new WebSocket(WS_URL, { headers: { Authorization: `Token ${ephemeralKey}` } });

// Réplica exacta de la lógica de mapeo del componente cliente.
const speakerLabels = new Map();
function majoritySpeaker(words) {
  const counts = new Map();
  for (const w of words) {
    if (w.speaker === undefined) continue;
    counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  let best, bestCount = 0;
  for (const [spk, c] of counts) if (c > bestCount) { best = spk; bestCount = c; }
  return best;
}
function labelFor(speakerIndex) {
  const existing = speakerLabels.get(speakerIndex);
  if (existing) return existing;
  const label = speakerLabels.size === 0 ? "Doctor" : speakerLabels.size === 1 ? "Paciente" : `Hablante ${speakerLabels.size + 1}`;
  speakerLabels.set(speakerIndex, label);
  return label;
}

const results = [];

await new Promise((resolve, reject) => {
  ws.addEventListener("error", (e) => reject(new Error(`WS error: ${e.message || e.type}`)));
  ws.addEventListener("close", () => resolve(null));
  ws.addEventListener("message", (msg) => {
    try {
      const data = JSON.parse(msg.data);
      const alt = data.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      if (data.is_final && text) {
        const speakerIndex = majoritySpeaker(alt?.words ?? []);
        const label = speakerIndex !== undefined ? labelFor(speakerIndex) : "?";
        console.log(`[speaker=${speakerIndex} → ${label}] "${text}"`);
        results.push({ speakerIndex, label, text });
      }
    } catch { /* ignore */ }
  });

  ws.addEventListener("open", async () => {
    const raw = readFileSync(WAV_PATH);
    const pcm = raw.subarray(44);
    const CHUNK = 3200; // 0.1s de audio a 16kHz/16-bit/mono
    for (let offset = 0; offset < pcm.length; offset += CHUNK) {
      ws.send(pcm.subarray(offset, offset + CHUNK));
      await new Promise((r) => setTimeout(r, 100)); // ritmo real-time (no más rápido)
    }
    console.log("(audio completo enviado, esperando flush + finales…)");
    await new Promise((r) => setTimeout(r, 3000)); // deja que Deepgram procese el buffer
    ws.send(JSON.stringify({ type: "CloseStream" }));
    setTimeout(() => ws.close(), 15000);
  });
});

console.log("\n=== RESUMEN ===");
const distinctSpeakers = new Set(results.map((r) => r.speakerIndex)).size;
console.log(`Hablantes distintos detectados: ${distinctSpeakers}`);
console.log(`Etiquetas asignadas: ${[...speakerLabels.entries()].map(([i, l]) => `${i}→${l}`).join(", ")}`);
for (const r of results) console.log(`  ${r.label}: "${r.text}"`);

if (distinctSpeakers >= 2 && results.some((r) => r.label === "Doctor") && results.some((r) => r.label === "Paciente")) {
  console.log("\n🎉 DIARIZACIÓN VERIFICADA: Deepgram distingue Doctor de Paciente correctamente.");
} else {
  console.log("\n⚠️  No se detectaron 2 hablantes distintos con las etiquetas esperadas.");
}
