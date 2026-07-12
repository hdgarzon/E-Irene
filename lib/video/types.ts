export interface VideoRoom {
  roomName: string;
  /** URL de la sala en el proveedor — la usan doctor y paciente por igual
   *  para unirse vía el SDK. NO es el link que recibe el paciente por email/
   *  WhatsApp (ese es siempre /join/[token], propio de la app). */
  roomUrl: string;
}

export type VideoMode = "mock" | "daily";

export interface VideoProvider {
  readonly mode: VideoMode;
  /** `contextId` es un identificador único para nombrar la sala (en la
   *  práctica, el id de la cita — ver ensureVideoRoom en Task 6 — nunca el
   *  id de una consulta, que puede no existir todavía en este punto). No se
   *  persiste ni se interpreta, solo entra en el nombre de la sala. */
  createRoom(contextId: string): Promise<VideoRoom>;
  deleteRoom(roomName: string): Promise<void>;
}
