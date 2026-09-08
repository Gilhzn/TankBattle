import type { ServerMessage } from '@tank/shared';
import type { Room } from './room.js';

/** A connected player's outbound channel (implemented by the WS session). */
export interface PlayerLink {
  send(msg: ServerMessage): void;
  /**
   * Binds this connection to a room it was placed in rather than asked for. Matchmaking seats
   * players itself, and a session that does not know which room it is in rejects their own input.
   */
  bindRoom?(room: Room): void;
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
