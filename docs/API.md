# IRONGRID — API contract (server ⇄ client)

All JSON. Errors: HTTP 4xx/5xx with body `{ "error": { "code": string, "message": string } }`.
Auth: `Authorization: Bearer <token>` on everything except `/api/auth/guest`, `/api/health`, `/api/store/webhook/stripe`.
The token is an HS256 "JWT-shaped" token issued by the server (`packages/server/src/auth/tokens.ts`).

## DTOs
```ts
UserDTO      { id: string; nickname: string; skin: string; createdAt: number; settings: Record<string, unknown> }
WalletDTO    { coins: number; gems: number }
InventoryDTO Record<sku, { qty: number; equipped: boolean }>
DailyDTO     { streak: number; day: number /* 1..7, the NEXT reward index */; claimable: boolean; nextClaimAt: number; rewards: DAILY_REWARDS }
BattlePassDTO{ season: number; endsAt: number; xp: number; tier: number; premium: boolean; claimedFree: number[]; claimedPremium: number[]; tiers: BATTLEPASS_TIERS }
StatsDTO     { matches: number; bestScore: number; bestStage: number; kills: number }
GiftDTO      { id: string; fromName: string; toName: string; sku: string; qty: number; message: string; status: 'pending'|'claimed'; createdAt: number }
OrderDTO     { id: string; sku: string; provider: 'mock'|'stripe'; status: 'pending'|'completed'|'failed'; amountCents: number; currency: 'usd' }
LeaderEntry  { rank: number; name: string; score: number; stage: number; mode: string }
```

## REST
| Method | Path | Body | Response |
|---|---|---|---|
| POST | /api/auth/guest | `{deviceToken?, nickname?}` | `{token, user: UserDTO, isNew: boolean}` |
| GET | /api/me | | `{user, wallet, inventory, battlepass, daily, stats, pendingGifts: number, provider: 'mock'|'stripe'}` |
| PATCH | /api/me | `{nickname?, skin?, settings?}` | `{user}` |
| GET | /api/store/catalog | | `{items: CatalogItem[], ownedOneTime: string[], provider}` |
| POST | /api/store/purchase | `{sku, qty, currency:'coins'|'gems'}` | `{wallet, inventory}` |
| POST | /api/store/checkout | `{sku}` (usd-priced item) | `{orderId, provider, redirectUrl?, clientSecret?}` — mock provider returns `redirectUrl: "/#/checkout/<orderId>"` |
| POST | /api/store/mock/complete | `{orderId}` | `{order: OrderDTO, wallet, inventory}` (idempotent; 404 if provider is not mock) |
| POST | /api/store/webhook/stripe | raw Stripe event | `{received: true}` |
| GET | /api/store/orders | | `{orders: OrderDTO[]}` |
| GET | /api/inventory | | `{inventory}` |
| POST | /api/inventory/equip | `{sku}` (cosmetic) | `{user, inventory}` |
| GET | /api/rewards/daily | | `DailyDTO` |
| POST | /api/rewards/daily/claim | | `{reward, wallet, inventory, daily: DailyDTO}` |
| POST | /api/rewards/ad/start | `{placement:'results'|'menu'}` | `{adSessionId, minSeconds, remainingToday}` |
| POST | /api/rewards/ad/complete | `{adSessionId, placement}` | `{coins, wallet}` (409 if too fast / limit) |
| GET | /api/battlepass | | `BattlePassDTO` |
| POST | /api/battlepass/claim | `{tier, track:'free'|'premium'}` | `{wallet, inventory, battlepass}` |
| POST | /api/battlepass/premium | | `{wallet, battlepass}` (pays 950 gems) |
| POST | /api/gifts/send | `{to: nickname|userId, sku, qty, message?}` | `{gift: GiftDTO, inventory, wallet}` |
| GET | /api/gifts/inbox | | `{gifts: GiftDTO[]}` (pending first) |
| POST | /api/gifts/:id/claim | | `{wallet, inventory}` |
| POST | /api/solo/start | `{loadout: sku[], stage?}` | `{soloId, seed, stage, boosts: BoostEffect[], inventory}` — consumes at-start + on-demand boosts from inventory, authorises their effects |
| POST | /api/solo/result | `soloResultSchema` | `{verified: boolean, score, stage, coins, xp, wallet, battlepass}` |
| GET | /api/leaderboard?mode=solo|coop|versus | | `{entries: LeaderEntry[], me?: LeaderEntry}` |
| GET | /api/health | | `{ok: true, uptime, rooms, players}` |

Static: `/` serves `packages/client/dist` (SPA fallback to index.html). WebSocket: `/ws`.

## WebSocket
Messages are JSON, validated by `clientMessageSchema` / typed by `ServerMessage` in `@tank/shared`.
1. connect → send `hello {token, version: PROTOCOL_VERSION}` → `welcome`.
2. public games: `matchQueue {queue}` (`1v1 | 2v2 | ffa | coop`, see `MATCH_QUEUES`) → `queued {found, needed, startsInMs}` while searching → `matchFound` + `roomState` when seated. `matchCancel` leaves the queue. Nobody hosts and no code is exchanged; the server groups by rating, and after `MATCHMAKING_TIMEOUT_MS` starts with whoever is present, filling only up to the queue's `min`.
3. playing with a friend: `inviteFriend {friendId}` opens a private room and pushes `gameInvite {fromName, code}` to that friend's live session; they answer with `joinRoom {code}`. `createRoom` / `joinRoom` exist only for this path.
4. lobby (invite rooms only — matched rooms start themselves): `setReady`, `setLoadout`, `chat`; host sends `startGame` → `roomState{status:'countdown', countdownEndsAt}` → after 3 s `gameStart {seed, stage, snapshot (full Snapshot), yourSlot}`.
5. playing: client sends `input {seq, dir, fire}` on change and at least every 10 ticks; server sends `snapshot {snapshot}` at 15 Hz (`snapshot.full` true every 60 ticks / on join). `useItem {sku, nonce}` → `itemResult`.
6. `stageClear` per stage; `gameOver {reason, results}` then `walletUpdate`, then `roomState{status:'lobby'}`.
7. Disconnect: server keeps the seat 30 s; client reconnects, sends `hello` then `resume {roomId, resumeToken}` → `roomState` + full `snapshot`.
8. `ping {t}` → `pong {t, serverTick, serverTime}` every 5 s for RTT.

Loadout semantics: boost SKUs with `atStart` are consumed from inventory at game start and applied as commands on tick 1 (`life`, `shield` (300 ticks), `star`). On-demand boosts (`grenade`, `clock`, `revive`) are consumed when `useItem` succeeds (inventory ≥ 1, `maxPerMatch` not exceeded, room playing). Boosts are ignored in versus mode.

Rewards: at `gameOver` the server calls `matchRewards(score, stagesCleared, kills, coop)` per player, credits coins (ledger reason `match`) and battle-pass XP, records `match_results`.

## Dev ports
Server `PORT=8080` (env). Vite dev server 5173 proxies `/api` and `/ws` to 8080. Playwright uses the production server on 4173 serving the built client.
