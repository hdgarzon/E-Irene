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

/**
 * Parámetros de query para el WebSocket de streaming (español, webm/opus desde
 * MediaRecorder). `diarize=true` activa la identificación de hablantes:
 * Deepgram devuelve un índice `speaker` por palabra en `channel.alternatives[0].words[]`.
 */
export const DEEPGRAM_LISTEN_URL =
  "wss://api.deepgram.com/v1/listen?model=nova-3&language=es&encoding=opus&smart_format=true&interim_results=true&punctuate=true&diarize=true";
