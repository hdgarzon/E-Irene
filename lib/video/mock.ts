import { randomUUID } from "node:crypto";
import type { VideoProvider, VideoRoom } from "./types";

/** Sin DAILY_API_KEY (o con VIDEO_PROVIDER=mock): sala simulada, sin red. */
export class MockVideoProvider implements VideoProvider {
  readonly mode = "mock" as const;

  async createRoom(contextId: string): Promise<VideoRoom> {
    const roomName = `mock-${contextId}-${randomUUID().slice(0, 8)}`;
    return { roomName, roomUrl: `https://mock.video/${roomName}` };
  }

  async deleteRoom(roomName: string): Promise<void> {
    void roomName;
    // no-op: no hay red que limpiar en modo mock.
  }
}
