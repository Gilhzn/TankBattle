import type { ServerMessage } from '@tank/shared';

/** A connected player's outbound channel (implemented by the WS session). */
export interface PlayerLink {
  send(msg: ServerMessage): void;
}

export interface RoomUser {
  id: string;
  name: string;
  skin: string;
}

/** Error surfaced to the client as `error{code,message}`. */
export class RoomError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'RoomError';
  }
}
