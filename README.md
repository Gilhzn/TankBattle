# Tank 1990 Online

A modern, mobile-first remake of **Tank 1990 / Battle City** for the web: neon 2026 visuals, online co-op and versus multiplayer for up to 4 players, an installable PWA that plays offline, and a server-authoritative economy (coins, gems, boosts, skins, battle pass, daily rewards, gifting).

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
```

## Tests
```bash
npm test           # vitest: shared sim, server integration, client units
npm run e2e        # Playwright (builds must exist: npm run build first)
```
