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
  /**
   * Sends a message that has already been serialised. A room broadcasts the identical snapshot to
   * every seat thirty times a second, and encoding it once instead of once per player is most of
   * the tick budget back on a small instance.
   */
  sendRaw?(json: string): void;
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
