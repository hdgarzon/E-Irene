/**
 * Test de integración real: Deepgram WebSocket STT con audio WAV TTS en español.
 * Usa Node 22 WebSocket nativo (sin dependencias extra).
 * No forma parte de la suite CI.
 */
import { readFileSync, existsSync } from "node:fs";

const KEY_FILE = new URL("../.env.local", import.meta.url);
const env = readFileSync(KEY_FILE, "utf8");
const DEEPGRAM_KEY = env.match(/^DEEPGRAM_API_KEY=(.+)$/m)?.[1];
const PROJECT_ID = "105aefe1-8154-4eb8-be3d-71b4d5f8731b";
const WAV_PATH = "/tmp/dg-test.wav";

if (!DEEPGRAM_KEY) throw new Error("No se encontró DEEPGRAM_API_KEY en .env.local");
if (!existsSync(WAV_PATH)) throw new Error(`WAV no encontrado: ${WAV_PATH}`);

// 1. Crear key efímera vía Project Keys API
console.log("Creando key efímera de Deepgram...");
const keyRes = await fetch(`https://api.deepgram.com/v1/projects/${PROJECT_ID}/keys`, {
  method: "POST",
  headers: { Authorization: `Token ${DEEPGRAM_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    comment: "e-irene-ws-node-test",
    scopes: ["usage:write"],
    time_to_live_in_seconds: 120,
  }),
});
if (!keyRes.ok) throw new Error(`Error creando key: ${keyRes.status} ${await keyRes.text()}`);
const { key: ephemeralKey } = await keyRes.json();
console.log(`Key efímera: ${ephemeralKey.slice(0, 8)}... ✓`);

// 2. Abrir WebSocket a Deepgram con la key efímera
const WS_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=es&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=true&punctuate=true";

const ws = new WebSocket(WS_URL, {
  headers: { Authorization: `Token ${ephemeralKey}` },
});

const transcripts = [];

await new Promise((resolve, reject) => {
  ws.addEventListener("error", (e) => reject(new Error(`WS error: ${e.message || e.type}`)));
  ws.addEventListener("close", (e) => {
    if (transcripts.length === 0) reject(new Error(`WS cerrado sin transcripciones (code=${e.code})`));
    else resolve(null);
  });
  ws.addEventListener("message", (msg) => {
    try {
      const data = JSON.parse(msg.data);
      const text = data.channel?.alternatives?.[0]?.transcript?.trim();
      if (data.is_final && text) {
        console.log(`[final] "${text}"`);
        transcripts.push(text);
      } else if (text) {
        process.stdout.write(`\r[interim] "${text}"  `);
      }
    } catch { /* ignore non-JSON frames */ }
  });

  ws.addEventListener("open", async () => {
    console.log("WebSocket abierto ✓");

    // Lee el WAV: saltar el header de 44 bytes para enviar PCM raw
    const raw = readFileSync(WAV_PATH);
    const pcm = raw.subarray(44); // salta header WAV
    const CHUNK = 3200; // ~100ms a 16kHz 16-bit mono

    // Envía PCM en chunks
    for (let offset = 0; offset < pcm.length; offset += CHUNK) {
      ws.send(pcm.subarray(offset, offset + CHUNK));
      await new Promise((r) => setTimeout(r, 80)); // ritmo ~real-time
    }
    console.log("\nAudio enviado, esperando respuestas finales...");

    // Señal de fin de stream
    ws.send(JSON.stringify({ type: "CloseStream" }));
    setTimeout(() => ws.close(), 10000);
  });
});

console.log("\n=== TRANSCRIPCIÓN FINAL ===");
console.log(transcripts.join(" "));

// Verificar que se capturaron palabras clave del TTS
const full = transcripts.join(" ").toLowerCase();
const expected = ["ansioso", "trabajo", "doctor"];
const found = expected.filter((w) => full.includes(w));
console.log(`\nPalabras esperadas: ${expected.join(", ")}`);
console.log(`Encontradas: ${found.join(", ") || "(ninguna)"}`);

if (found.length >= 2) {
  console.log("\n🎉 DEEPGRAM REAL: transcripción verificada end-to-end (Node → Deepgram → texto)");
} else {
  console.log(`\n⚠️  Transcripción obtenida pero sin palabras clave esperadas (¿idioma/audio correcto?)`);
}
