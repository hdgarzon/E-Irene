import { randomUUID } from "node:crypto";
import type { VideoProvider, VideoRoom } from "./types";

const DAILY_API_BASE = "https://api.daily.co/v1";

/**
 * Videollamada real vía Daily.co. Resuelve TURN/NAT traversal por nosotros
 * (crítico para que pacientes en redes restrictivas puedan conectar). Salas
 * privadas: solo se puede entrar con un meeting token (ver createMeetingToken),
 * nunca por la URL sola — la URL además NUNCA se expone directo al paciente,
 * solo vía /join/[token] (ver lib/video/join-token.ts y el spec, sección 7).
 */
export class DailyVideoProvider implements VideoProvider {
  readonly mode = "daily" as const;

  private apiKey(): string {
    const key = process.env.DAILY_API_KEY;
    if (!key) throw new Error("DAILY_API_KEY no está configurada");
    return key;
  }

  async createRoom(contextId: string): Promise<VideoRoom> {
    const res = await fetch(`${DAILY_API_BASE}/rooms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Sufijo aleatorio: si una llamada anterior creó la sala pero la
        // escritura en BD falló antes de guardar el nombre (ensureVideoRoom,
        // Task 6), un reintento no debe colisionar con la sala huérfana.
        name: `apt-${contextId}-${randomUUID().slice(0, 8)}`,
        privacy: "private",
        properties: {
          // Vencimiento amplio (24h): la ventana real de acceso la controla
          // isJoinWindowOpen()/video_join_token, no esto — es solo un tope
          // de limpieza para no acumular salas huérfanas en Daily.
          exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
          max_participants: 2,
          // enable_recording se omite a propósito: Daily.co solo graba si la
          // propiedad está presente (valores "cloud"/"local"/...), así que no
          // enviarla es la forma de garantizar que nunca se graba (spec §8).
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Daily.co (rooms) respondió ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { name: string; url: string };
    if (!data.name || !data.url) {
      throw new Error("Daily.co (rooms) respondió 200 sin name/url");
    }
    return { roomName: data.name, roomUrl: data.url };
  }

  async deleteRoom(roomName: string): Promise<void> {
    const res = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.apiKey()}` },
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`Daily.co (delete room) respondió ${res.status}`);
    }
  }

  /**
   * Token de acceso a una sala privada, propio de esta implementación (no
   * forma parte de la interfaz VideoProvider — solo DailyVideoProvider lo
   * necesita; MockVideoProvider no valida nada). `isOwner` da controles de
   * host (usado por el doctor); el paciente entra con isOwner=false.
   */
  async createMeetingToken(params: {
    roomName: string;
    userName: string;
    isOwner: boolean;
    expiresInSeconds: number;
  }): Promise<string> {
    const res = await fetch(`${DAILY_API_BASE}/meeting-tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          room_name: params.roomName,
          user_name: params.userName,
          is_owner: params.isOwner,
          exp: Math.floor(Date.now() / 1000) + params.expiresInSeconds,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Daily.co (meeting-tokens) respondió ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { token: string };
    if (!data.token) {
      throw new Error("Daily.co (meeting-tokens) respondió 200 sin token");
    }
    return data.token;
  }
}
