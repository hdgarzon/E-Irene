import type { TranscriptionProvider, TranscriptionSession } from "./types";

const TTL_SECONDS = 3600; // cubre una sesión clínica típica (≤50 min)

/**
 * Transcripción real con Deepgram. El servidor SOLO acuña una API key
 * efímera y de alcance limitado (Project Keys API) — el audio nunca pasa
 * por aquí. El navegador abre el WebSocket directo a Deepgram con esa key.
 */
export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  readonly mode = "deepgram" as const;

  private async getProjectId(apiKey: string): Promise<string> {
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Deepgram (projects) respondió ${res.status}`);
    const data = (await res.json()) as { projects: { project_id: string }[] };
    const project = data.projects[0];
    if (!project) throw new Error("La cuenta de Deepgram no tiene proyectos");
    return project.project_id;
  }

  async createSession(consultationId: string): Promise<TranscriptionSession> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("DEEPGRAM_API_KEY no está configurada");

    const projectId = await this.getProjectId(apiKey);

    // Key efímera, alcance mínimo (solo uso, sin permisos de gestión).
    const res = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        comment: `e-irene-consultation-${consultationId}`,
        scopes: ["usage:write"],
        time_to_live_in_seconds: TTL_SECONDS,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Deepgram respondió ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as { key: string };
    return {
      sessionToken: data.key,
      mode: "deepgram",
      expiresInMs: TTL_SECONDS * 1000,
    };
  }
}

const DEEPGRAM_LISTEN_BASE =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=es&encoding=opus&smart_format=true&interim_results=true&punctuate=true";

/**
 * Modo texto in-person: una sola pista con ambos hablantes mezclados.
 * `diarize=true` activa la identificación de hablantes: Deepgram devuelve un
 * índice `speaker` por palabra en `channel.alternatives[0].words[]`, que usa
 * la heurística de lib/diarization.ts para separar Doctor/Paciente.
 *
 * Costo/límites (verificado jul-2026 contra developers.deepgram.com/reference/api-rate-limits
 * y deepgram.com/pricing): `diarize=true` mete la conexión en el pool de
 * concurrencia "Speaker Diarization" (más bajo que el de STT general — ver
 * DEEPGRAM_LISTEN_URL_VIDEO) y añade un add-on de facturación de streaming
 * (~$0.0020/min sobre ~$0.0048/min base, pay-as-you-go). Necesario aquí; no
 * quitar sin revisar lib/diarization.ts.
 */
export const DEEPGRAM_LISTEN_URL = `${DEEPGRAM_LISTEN_BASE}&diarize=true`;

/**
 * Modo video: cada una de las dos conexiones (mic del doctor, pista remota del
 * paciente vía Daily.co) ya sabe de quién es el audio, así que NO se activa
 * diarización — pedirla de más solo bajaría el límite de concurrencia
 * disponible y pagaría un add-on que no se usa (ver comentario extenso en
 * components/live-consultation.tsx antes de handleRemoteAudioTrack).
 */
export const DEEPGRAM_LISTEN_URL_VIDEO = DEEPGRAM_LISTEN_BASE;
