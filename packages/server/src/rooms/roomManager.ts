import type { Difficulty, VersusFormat } from '@tank/shared';
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

/** Owns all rooms: creation, code lookup, auto-start ticking and cleanup. */
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

  create(
    user: RoomUser,
    link: PlayerLink,
    mode: 'coop' | 'versus',
    isPrivate: boolean,
    loadout: string[],
    quickPlay = false,
    difficulty: Difficulty = 'normal',
    versusFormat: VersusFormat = 'ffa',
    /** Versus only: which arena to play in, chosen from the players' rating band. */
    stage = 0,
  ): Room {
    let code = newJoinCode();
    while (this.byCode.has(code)) code = newJoinCode();
    const room = new Room(newId(), code, mode, difficulty, versusFormat, isPrivate, quickPlay, stage, {
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
