import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/server.js';
import { WsClient, guest, sleep, startTestServer, type AnyMsg } from './helpers.js';

interface RoomState extends AnyMsg {
  roomId: string;
  code: string;
  status: string;
  hostId: string;
  players: Array<{ id: string; slot: number; isHost: boolean; connected: boolean }>;
  resumeToken?: string;
}
type Snapshot = { t: number; full: boolean; tanks: Array<[number, number, string, number, number]>; players: Array<{ slot: number; id: string }> };
interface SnapshotMsg extends AnyMsg {
  snapshot: Snapshot;
}

let server: RunningServer;
const clients: WsClient[] = [];

async function connect(token: string): Promise<WsClient> {
  const c = new WsClient(server.wsUrl);
  await c.open();
  await c.hello(token);
  clients.push(c);
  return c;
}

beforeAll(async () => {
  server = await startTestServer({ tickRate: 200, snapshotEvery: 2, fullSnapshotEvery: 20, disconnectGraceMs: 2000, quickPlayWaitMs: 500 });
});
afterAll(async () => {
  for (const c of clients) c.close();
  await server.close();
});

const tankOf = (snap: Snapshot, slot: number) => snap.tanks.find((t) => t[1] === slot && t[2] === 'player');

describe('rooms over websocket', () => {
  it('create → join → start → snapshots → move → resume → leave', async () => {
    const ua = await guest(server, 'HostA');
    const ub = await guest(server, 'GuestB');
    const a = await connect(ua.token);
    const b = await connect(ub.token);

    a.send({ type: 'createRoom', mode: 'coop', isPrivate: false, loadout: [] });
    const created = await a.waitFor<RoomState>('roomState');
    expect(created.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(created.players).toHaveLength(1);
    expect(created.hostId).toBe(ua.id);
    expect(typeof created.resumeToken).toBe('string');

    b.send({ type: 'joinRoom', code: created.code, loadout: [] });
    const joinedB = await b.waitFor<RoomState>('roomState', (m) => m.players.length === 2);
    const joinedA = await a.waitFor<RoomState>('roomState', (m) => m.players.length === 2);
    expect(joinedA.players.map((p) => p.id).sort()).toEqual([ua.id, ub.id].sort());
    expect(joinedB.resumeToken).not.toBe(created.resumeToken);

    b.send({ type: 'startGame' });
    const err = await b.waitFor('error');
    expect(err.code).toBe('not_host');

    a.send({ type: 'startGame' });
    await a.waitFor<RoomState>('roomState', (m) => m.status === 'countdown');
    const startA = await a.waitFor<{ yourSlot: number; seed: number; snapshot: Snapshot } & AnyMsg>('gameStart');
    const startB = await b.waitFor<{ yourSlot: number } & AnyMsg>('gameStart');
    expect(startA.yourSlot).toBe(0);
    expect(startB.yourSlot).toBe(1);
    expect(startA.snapshot.full).toBe(true);
    const y0 = tankOf(startA.snapshot, 0)![4];

    // Drive slot 0 upwards for ~40 ticks; y (sub-pixels) must decrease.
    a.send({ type: 'input', seq: 1, dir: 0, fire: false });
    await sleep(250);
    a.send({ type: 'input', seq: 2, dir: -1, fire: false });
    const snaps = a.drain('snapshot') as SnapshotMsg[];
    expect(snaps.length).toBeGreaterThan(5);
    const latest = snaps[snaps.length - 1].snapshot;
    expect(latest.t).toBeGreaterThan(30);
    expect(tankOf(latest, 0)![4]).toBeLessThan(y0);
    expect(snaps.some((s) => s.snapshot.full)).toBe(true);

    // Stale sequence numbers are ignored (no crash, still streaming).
    a.send({ type: 'input', seq: 1, dir: 2, fire: false });
    await a.waitFor('snapshot');

    // B drops and resumes with its token → roomState + full snapshot.
    b.close();
    const dc = await a.waitFor<RoomState>('roomState', (m) => m.players.some((p) => p.id === ub.id && !p.connected));
    expect(dc.players).toHaveLength(2);
    const b2 = await connect(ub.token);
    b2.send({ type: 'resume', roomId: created.roomId, resumeToken: joinedB.resumeToken! });
    const resumed = await b2.waitFor<RoomState>('roomState');
    expect(resumed.players.find((p) => p.id === ub.id)?.connected).toBe(true);
    const full = await b2.waitFor<SnapshotMsg>('snapshot', (m) => m.snapshot.full === true);
    expect(full.snapshot.players).toHaveLength(2);
    b2.send({ type: 'resume', roomId: created.roomId, resumeToken: 'wrong' });
    expect((await b2.waitFor('error')).code).toBe('bad_resume');

    // A leaves mid-game: gets `left`, host transfers to B.
    a.send({ type: 'leaveRoom' });
    await a.waitFor('left');
    const hostB = await b2.waitFor<RoomState>('roomState', (m) => m.hostId === ub.id);
    expect(hostB.players).toHaveLength(1);
    b2.send({ type: 'leaveRoom' });
    await b2.waitFor('left');
  });

  it('rejects bad messages and kicks flooders', async () => {
    const u = await guest(server, 'Flooder');
    const c = await connect(u.token);
    c.sendRaw('{not json');
    expect((await c.waitFor('error')).code).toBe('bad_message');
    c.send({ type: 'input', seq: -1, dir: 9 });
    expect((await c.waitFor('error')).code).toBe('bad_message');
    c.send({ type: 'setReady', ready: true });
    expect((await c.waitFor('error')).code).toBe('not_in_room');
    for (let i = 0; i < 200; i++) c.send({ type: 'ping', t: i });
    const kicked = await c.waitFor('kicked');
    expect(kicked.reason).toBe('rate_limit');
    await c.waitClosed();
  });

  it('requires hello first and replaces duplicate sessions', async () => {
    const u = await guest(server, 'Dup');
    const raw = new WsClient(server.wsUrl);
    await raw.open();
    raw.send({ type: 'ping', t: 1 });
    expect((await raw.waitFor('error')).code).toBe('not_authenticated');
    raw.send({ type: 'hello', token: 'not-a-valid-token', version: 1 });
    expect((await raw.waitFor('error')).code).toBe('unauthorized');
    await raw.waitClosed();
    const first = await connect(u.token);
    const second = await connect(u.token);
    expect((await first.waitFor('kicked')).reason).toBe('replaced');
    second.send({ type: 'ping', t: 42 });
    expect((await second.waitFor('pong')).t).toBe(42);
  });

  it('puts two searchers into one match with nobody hosting and no code passed around', async () => {
    const u1 = await guest(server, 'QuickOne');
    const u2 = await guest(server, 'QuickTwo');
    const c1 = await connect(u1.token);
    const c2 = await connect(u2.token);
    c1.send({ type: 'matchQueue', queue: '1v1', loadout: [], lang: 'en' });
    // Alone in the queue, the first player is told how full the match is rather than left blank.
    const progress = await c1.waitFor<{ found: number; needed: number } & AnyMsg>('queued');
    expect(progress).toMatchObject({ found: 1, needed: 2, searching: true });
    c2.send({ type: 'matchQueue', queue: '1v1', loadout: [], lang: 'en' });
    const found1 = await c1.waitFor<{ roomId: string } & AnyMsg>('matchFound');
    const found2 = await c2.waitFor<{ roomId: string } & AnyMsg>('matchFound');
    expect(found2.roomId).toBe(found1.roomId);
    const state = await c2.waitFor<RoomState>('roomState', (m) => m.players.length === 2);
    expect(state.mode).toBe('versus');
    // A matched room starts itself: neither player is asked to press anything.
    await c1.waitFor('gameStart', undefined, 4000);
    await c2.waitFor('gameStart', undefined, 4000);
    c1.send({ type: 'chat', text: 'gl hf' });
    const chat = await c2.waitFor('chat');
    expect(chat.text).toBe('gl hf');
    expect(chat.from).toBe(u1.id);
  });

  it('lets a player cancel the search', async () => {
    const u = await guest(server, 'Wanderer');
    const c = await connect(u.token);
    c.send({ type: 'matchQueue', queue: 'ffa', loadout: [], lang: 'en' });
    await c.waitFor('queued', (m) => (m as unknown as { searching: boolean }).searching);
    c.send({ type: 'matchCancel' });
    const stopped = await c.waitFor<{ searching: boolean } & AnyMsg>('queued', (m) => !(m as unknown as { searching: boolean }).searching);
    expect(stopped.searching).toBe(false);
  });

  it('invites a friend into a private room, and refuses to invite a stranger', async () => {
    const host = await guest(server, 'HostPal');
    const pal = await guest(server, 'InvitedPal');
    const stranger = await guest(server, 'StrangerPal');
    const ch = await connect(host.token);
    const cp = await connect(pal.token);
    await connect(stranger.token);

    // Not friends yet: the invitation is refused rather than reaching them.
    ch.send({ type: 'inviteFriend', friendId: stranger.id });
    expect((await ch.waitFor('error')).code).toBe('not_friends');

    // A friend who is not connected cannot be pulled into a match either.
    const away = await guest(server, 'AwayPal');
    server.app.db.friends.link(host.id, away.id, Date.now());
    ch.send({ type: 'inviteFriend', friendId: away.id });
    expect((await ch.waitFor('error')).code).toBe('friend_offline');

    server.app.db.friends.link(host.id, pal.id, Date.now());
    ch.send({ type: 'inviteFriend', friendId: pal.id });
    const invite = await cp.waitFor<{ fromName: string; code: string } & AnyMsg>('gameInvite');
    expect(invite.fromName).toBe('HostPal');

    // The invited player joins with the code the invitation carried — nobody typed it.
    cp.send({ type: 'joinRoom', code: invite.code, loadout: [] });
    const state = await cp.waitFor<RoomState>('roomState', (m) => m.players.length === 2);
    expect(state.players.map((p) => p.id).sort()).toEqual([host.id, pal.id].sort());
  });

  it('health reports rooms and players', async () => {
    const res = await fetch(server.url + '/api/health').then((r) => r.json() as Promise<{ ok: boolean; rooms: number; players: number }>);
    expect(res.ok).toBe(true);
    expect(res.rooms).toBeGreaterThanOrEqual(1);
  });
});
