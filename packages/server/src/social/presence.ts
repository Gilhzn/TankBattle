import type { Clock } from '../util/time.js';

export type PresenceState = 'online' | 'in_match' | 'offline';

export interface PresenceInfo {
  state: PresenceState;
  /** ms since epoch, or 0 if never seen. Only meaningful when offline. */
  lastSeen: number;
}

/**
 * Who is online right now.
 *
 * Live connections are the source of truth: the websocket gateway registers a player on connect and
 * drops them on disconnect. A player with no live connection falls back to the `lastSeen` stamp on
 * their user row, which survives a server restart — so after a redeploy the list degrades to
 * "recently active" rather than claiming everyone is offline.
 */
export class Presence {
  /** userId -> number of live connections (a player may have the game open in two tabs). */
  private connections = new Map<string, number>();
  private inMatch = new Set<string>();

  constructor(
    private readonly clock: Clock,
    /** How recently a disconnected player must have been seen to still count as online. */
    private readonly graceMs = 90_000,
  ) {}

  connect(userId: string): void {
    this.connections.set(userId, (this.connections.get(userId) ?? 0) + 1);
  }

  disconnect(userId: string): void {
    const n = (this.connections.get(userId) ?? 0) - 1;
    if (n > 0) this.connections.set(userId, n);
    else {
      this.connections.delete(userId);
      this.inMatch.delete(userId);
    }
  }

  enterMatch(userId: string): void {
    this.inMatch.add(userId);
  }

  leaveMatch(userId: string): void {
    this.inMatch.delete(userId);
  }

  isConnected(userId: string): boolean {
    return (this.connections.get(userId) ?? 0) > 0;
  }

  /** Everyone with a live connection. */
  get onlineCount(): number {
    return this.connections.size;
  }

  /** State for one player. `lastSeen` comes from their user row. */
  of(userId: string, lastSeen = 0): PresenceInfo {
    if (this.isConnected(userId)) return { state: this.inMatch.has(userId) ? 'in_match' : 'online', lastSeen: this.clock() };
    // After a restart the connection map is empty but the stamps are not, so a player who was
    // active moments ago still reads as online rather than blinking offline for everybody.
    if (lastSeen && this.clock() - lastSeen <= this.graceMs) return { state: 'online', lastSeen };
    return { state: 'offline', lastSeen };
  }
}
