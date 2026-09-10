# IRONGRID

A four-player tank arena on a destructible grid, built mobile-first for the web: neon 2026 visuals,
online co-op and versus for up to 4 players, an installable PWA that plays offline, and a
server-authoritative economy (coins, gems, boosts, skins, battle pass, daily rewards, gifting).

Everything here is original work — see [NOTICE.md](NOTICE.md).

## Quick start

```bash
npm install
npm run dev          # server on :8080 (tsx watch) + Vite client on :5173
```
Open http://localhost:5173 on desktop or a phone on the same network.

Production:
```bash
npm run build        # builds shared, server and client (+ generates PWA icons)
npm start            # serves the built client and the API/WS on PORT (default 8080)
```

Environment variables (server): `PORT`, `SECRET` (token signing key), `DB_PATH` (`.data/tank.db` default; `:memory:` or `json:<path>` to force the JSON store), `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (enables the Stripe provider; otherwise the sandbox mock store is used).

### Accounts

Guest play needs no configuration. The two real sign-in methods each need a credential you have to
create yourself; without it the game keeps working and simply does not offer that method.

| Variable | What it enables | Where it comes from |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | "Continue with Google" | A **Web application** OAuth client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Add your site to *Authorised JavaScript origins*. Only the client id is needed — there is no secret to store, because the client runs Google's own flow and the server verifies the resulting ID token against Google's published keys. |
| `MAIL_PROVIDER` | Email sign-in codes | `resend`, `sendgrid`, or `custom`. |
| `MAIL_API_KEY` | " | The provider's API key. |
| `MAIL_FROM` | " | A sender address you have verified with that provider. |
| `MAIL_ENDPOINT` | " | Only for `custom`: the URL to POST to. |

`PUBLIC_URL` is optional. The server derives its own address from the request, so invite links come
out absolute with nothing configured; set it (no trailing slash) only when a custom domain or an
extra proxy sits in front of the service, or when going live with Stripe, whose checkout redirects
are built outside any request.

With no `MAIL_PROVIDER`, verification codes are written to the server log instead of emailed, and
the sign-in screen says so rather than pretending a message was sent. That is fine for local
development and wrong for production.

Email sign-up refuses throwaway inbox providers, shared role addresses (`support@`, `admin@`) and
domains that publish no mail servers, and confirms the address with a six-digit code before the
account exists.

### Ranked play

| Variable | Default | Meaning |
| --- | --- | --- |
| `MATCHMAKING_TIMEOUT_MS` | `20000` | How long a player waits for a human opponent before the game fills the match itself. |
| `BOT_CHAT_API_KEY` | *(unset)* | An Anthropic API key for match chat from filled seats. Without it a built-in responder is used, which needs no network. |

## Multiplayer

- **Nobody hosts.** There is no room to create and no code to type: you pick **1v1**, **2v2**,
  **deathmatch** or **co-op**, and the server puts the match together. While you wait it says how
  many of the seats are filled and how long is left.
- **Pairing is by rating** (Elo, starting at 1000, K=20 — an even match moves 10 points, a slightly
  weaker opponent 9, a slightly stronger one 11), inside a window that widens as you wait. The arena
  changes every 100 rating points.
- **The wait is bounded.** After `MATCHMAKING_TIMEOUT_MS` (20 s) the match starts with whoever is
  there. Only the seats still missing below the mode's minimum are filled by the game, with an
  opponent rated near you and playing at that level — so a lone player still gets a match, and two
  people waiting for a deathmatch play each other rather than waiting on a third.
- **Deathmatch** seats up to four players, everyone for themselves.
- **2v2** pairs alternating seats across the arena, with the four ratings split as evenly as they
  divide. Teammates' shells pass through each other and a teammate's death scores nothing.
- **To play with someone specific**, use *Invite to game* on their row in your friends list. They
  get the invitation wherever they are in the app; the private room comes with it.
- Everyone gets **three eliminations**; the match ends when one side is left standing, with the
  clock as a stalemate fallback.
- Versus drops only pickups that cannot decide a duel — no grenade, no weapon upgrade, no freeze —
  and bought consumables are blocked on the same grounds, so nobody wins from the store.

## Friends

Requests are addressed by nickname (unique, case-insensitive), or shared as a WhatsApp link that
sends the request automatically when opened. The list shows who is online, who is in a match, and
when everyone else was last seen.

## Gameplay
- 26x26 tile field, 4-direction movement, brick (destructible), steel (only tier-3 shells), trees (hide tanks), water (blocks tanks unless you have the ship), ice (slides).
- Destroy all 20 enemies per stage (basic, fast, power, armor). Enemies #4, #11 and #18 flash and drop power-ups: ★ star, 1UP tank, 💣 grenade, ⏱ clock, 🛡 shovel, ⛑ helmet, ship, gun. Enemies can grab power-ups too, with nasty effects.
- Game over when the eagle base is hit or everyone runs out of lives. 12 authored stages, then procedurally generated sectors.
- Versus arena: 2-4 players, friendly fire, 3-minute timer.

## Business model
- **Coins** (earned by play, daily streaks, rewarded ads) and **Gems** (premium, with a small free drip).
- Boosts (extra life, start shield, star start, grenade, time freeze, revive) are capped per match and disabled in versus, so they help without breaking fairness. Cosmetic skins/trails are the main gem sink.
- 30-tier seasonal **Battle Pass** with free and premium tracks, 7-day **daily rewards**, **gifting** between players by nickname, rewarded-ad hooks, and a sandbox checkout (Stripe-ready adapter).
- All prices, grants and consumable use are validated server-side with a ledger; solo results are verified by replaying the deterministic simulation on the server.

## Repository layout
```
packages/shared   deterministic simulation, maps, protocol (zod), economy data, replay verification
packages/server   Node http + ws: auth, rooms/matchmaking, 30 Hz authoritative loop, economy REST, SQLite/JSON store
packages/client   Vite + TypeScript canvas client: renderer, touch/keyboard/gamepad input, screens, PWA
e2e               Playwright tests (desktop, mobile emulation, two-browser multiplayer, PWA)
docs/API.md       REST + WebSocket contract
docs/DEPLOY.md    where to host the server, and why the region decides the ping
```

## Deploying

**Vercel (client only — solo play).** The repo carries a `vercel.json`, so importing it at [vercel.com/new](https://vercel.com/new) needs no further setup: Vercel installs the workspace, builds `@tank/shared` then `@tank/client`, and serves `packages/client/dist`. Every push to the branch redeploys.

Vercel runs serverless functions, which cannot hold the long-lived WebSocket connections the game server needs — so a Vercel deployment serves the client only. Solo play, all 12 stages, power-ups, touch controls and the full UI work there; multiplayer, the store, battle pass and gifting stay in their offline state because there is no server behind them.

**Full game, multiplayer included.** `packages/server` is a long-running Node process (WebSocket + REST + SQLite) and needs a host that keeps a process alive — Render, Railway, Fly.io, or any VPS. It serves the built client itself, so one service covers everything.

- **Render** — `render.yaml` is a blueprint: point Render at the repo, and it installs, builds, starts
  the server, health-checks `/api/health` and generates `SECRET`. It deploys to **Frankfurt**,
  because the region is most of what a player feels: from Israel that is ~70 ms of ping instead of
  ~230 ms from Render's default US region. Render cannot move an existing service between regions,
  so see [docs/DEPLOY.md](docs/DEPLOY.md) for what that means in practice. It ships on the free plan, which
  means two things worth knowing: the database has no persistent disk, so every account, friendship,
  rating and wallet resets on each restart and deploy (the server warns about this at boot); and the
  service sleeps after ~15 minutes idle and takes 30-60s to wake, which the client handles by
  showing a "waking up" notice instead of falsely reporting the player offline. To keep the data,
  switch `plan` to `starter`, uncomment the `disk` block and set `DB_PATH=/var/data/tank.db`.
  After a deploy, `node scripts/smoke.mjs https://<your-service>.onrender.com` checks the server,
  guest auth, friends, profile and invite links in one go.
- **Railway / Fly.io / any Docker host** — the `Dockerfile` builds all three packages and runs the server as a non-root user. Mount a volume at `/data` to keep the database, which `DB_PATH` already points at.
- **Anywhere else**

  ```bash
  npm ci && npm run build
  PORT=8080 SECRET=<a long random string> DB_PATH=.data/tank.db npm start
  ```

`SECRET` signs guest session tokens: set it explicitly, or every restart invalidates existing sessions. The server binds all interfaces and reads `PORT`, so it works behind any platform's proxy; WebSockets are served on the same port at `/ws`.

## Tests
```bash
npm test           # vitest: shared sim, server integration, client units
npm run e2e        # Playwright (builds must exist: npm run build first)
```
