import type { GameRunner } from '../game/runner.js';
import { newId, newJoinCode } from '../util/ids.js';
import type { Logger } from '../util/log.js';
import type { Clock } from '../util/time.js';
import { Room } from './room.js';
import { RoomError, type PlayerLink, type RoomUser } from './types.js';

export interface RoomManagerOptions {
  clock: Clock;
  log: Logger;
  countdownMs: number;
  createRunner(room: Room): GameRunner;
  quickPlayWaitMs?: number;
  disconnectGraceMs?: number;
  emptyTtlMs?: number;
}

/** Owns all rooms: creation, code lookup, quick-play matchmaking and cleanup. */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private byCode = new Map<string, Room>();
  private ticker: NodeJS.Timeout;

  constructor(private readonly opts: RoomManagerOptions) {
    this.ticker = setInterval(() => this.tick(), 1000);
    this.ticker.unref();
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  byJoinCode(code: string): Room | undefined {
    return this.byCode.get(code.toUpperCase());
  }

  create(user: RoomUser, link: PlayerLink, mode: 'coop' | 'versus', isPrivate: boolean, loadout: string[], quickPlay = false): Room {
    let code = newJoinCode();
    while (this.byCode.has(code)) code = newJoinCode();
    const room = new Room(newId(), code, mode, isPrivate, quickPlay, {
      clock: this.opts.clock,
      log: this.opts.log,
      countdownMs: this.opts.countdownMs,
      disconnectGraceMs: this.opts.disconnectGraceMs,
      emptyTtlMs: this.opts.emptyTtlMs,
      createRunner: this.opts.createRunner,
      onEmpty: (r) => this.remove(r),
    });
    this.rooms.set(room.id, room);
    this.byCode.set(code, room);
    room.join(user, link, loadout);
    this.opts.log.debug(`room ${code} created by ${user.name} (${mode}${isPrivate ? ', private' : ''})`);
    return room;
  }

  join(user: RoomUser, link: PlayerLink, code: string, loadout: string[]): Room {
    const room = this.byJoinCode(code);
    if (!room) throw new RoomError('room_not_found', 'no room with that code');
    room.join(user, link, loadout);
    return room;
  }

  /** Joins the oldest public lobby with a free seat for the mode, or opens a new one. */
  quickPlay(user: RoomUser, link: PlayerLink, mode: 'coop' | 'versus', loadout: string[]): { room: Room; created: boolean } {
    const candidates = [...this.rooms.values()].filter((r) => r.mode === mode && !r.isPrivate && r.joinable && !r.player(user.id)).sort((a, b) => a.createdAt - b.createdAt);
    const room = candidates[0];
    if (room) {
      room.join(user, link, loadout);
      return { room, created: false };
    }
    return { room: this.create(user, link, mode, false, loadout, true), created: true };
  }

  remove(room: Room): void {
    room.destroy();
    this.rooms.delete(room.id);
    this.byCode.delete(room.code);
    this.opts.log.debug(`room ${room.code} removed`);
  }

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const r of this.rooms.values()) players += r.players.filter((p) => p.connected).length;
    return { rooms: this.rooms.size, players };
  }

  private tick(): void {
    const now = this.opts.clock();
    for (const r of this.rooms.values()) {
      try {
        r.maybeAutoStart(now, this.opts.quickPlayWaitMs ?? 10_000);
      } catch (err) {
        this.opts.log.warn(`auto-start failed for ${r.code}`, err);
      }
    }
  }

  close(): void {
    clearInterval(this.ticker);
    for (const r of [...this.rooms.values()]) this.remove(r);
  }
}
