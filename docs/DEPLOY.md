# Deploying the server, and where to put it

The single biggest thing a player feels is **how far away the server is**. Everything else in this
document is detail.

## Why the region is the whole game

Ping is distance. Fibre carries light at about 200,000 km/s, and a round trip pays for the distance
twice, plus routing:

| server region | distance from Tel Aviv | round trip you should expect |
|---|---|---|
| Oregon (Render's default) | ~12,000 km | **~220-240 ms** |
| Ohio / Virginia | ~9,500 km | ~160-180 ms |
| **Frankfurt** | ~2,900 km | **~60-80 ms** |
| a machine in Israel | — | ~10-25 ms |

Your own tank does not wait for any of this — it is simulated on your device and corrected by the
server (`packages/client/src/game/predict.ts`), and it answers a press in ~14 ms at any ping. What
the ping buys is how fresh *the other player* is: measured browser-to-browser, one player sees the
other move ~300 ms after they do at 240 ms of ping, and ~130 ms at 70 ms. The second number is the
one that stops reading as lag.

`render.yaml` therefore sets `region: frankfurt`.

## Moving an existing Render service to Frankfurt

Render cannot change a service's region after it is created, so this means creating a new service
from the blueprint. On the free plan the database is wiped by every deploy anyway, so nothing is
lost but the URL.

1. **Free the name** (optional). Render service names are unique per account, and the blueprint now
   asks for `irongrid`. If a service of that name already exists, either delete it first — which
   also releases its `.onrender.com` address — or let the new service be called something else; its
   URL follows its name.
2. **Render → Blueprints → New Blueprint Instance.**
3. Pick this repository, and **pick the branch the blueprint should track**. The blueprint lives on
   the feature branch this work is developed on; either select that branch, or merge it to `main`
   first and select `main`. Render redeploys on every push to whichever branch you choose.
4. Render reads `render.yaml`, shows one web service in **Frankfurt** on the free plan, and asks to
   apply. Apply.
5. First build takes a few minutes (it installs the workspace and builds all three packages). The
   service is live when `/api/health` answers.
6. **Retire the old service**, once the checks below pass against the new one. Suspend it for the
   first day rather than deleting it, so there is something to fall back to; delete it after. Until
   it is suspended it keeps rebuilding on every push to the tracked branch, and it keeps serving the
   old address to anyone who already has the link — including the friend invites sent from it.

Two free web services also cost twice as much of the account's free instance hours, which Render
meters across the account rather than per service, so leaving the old one running is not free even
while nobody is playing on it.

## Checking it worked

```bash
curl -s https://<your-service>.onrender.com/api/health
# {"ok":true,"uptime":12,"rooms":0,"players":0,"region":"frankfurt"}
```

`region` comes from Render's own `RENDER_REGION` and is `null` if the host does not set it — in that
case the ping is the answer: open the game, start a match, and read the `ms` chip in the HUD. It
should say roughly **60-90** instead of 225.

`node scripts/smoke.mjs https://<your-service>.onrender.com` then checks the server, guest auth,
friends, profile and invite links in one pass.

## What the free plan costs you

Two things, both documented at the top of `render.yaml`:

- **No persistent disk.** Accounts, friendships, ratings and wallets reset on every restart and
  deploy. The server logs a warning at boot saying exactly this. To keep them: `plan: starter`
  ($7/month), uncomment the `disk` block, set `DB_PATH=/var/data/tank.db`.
- **It sleeps** after ~15 minutes idle and takes 30-60 s to wake. The client is built for it: the
  boot budget is 45 s and it shows a "waking up" notice rather than claiming you are offline. The
  paid plan does not sleep, and it also gives 0.5 CPU instead of 0.1, which matters most with four
  players in a room.

## Going lower than Frankfurt

Render has no Israel region. ~15-25 ms means a machine in Tel Aviv — AWS `il-central-1`, Azure
Israel Central, GCP `me-west1`, or any Israeli VPS — running the same `Dockerfile`. Worth it only if
your players are all in Israel: a server is only close to one place at a time, and Frankfurt is a
reasonable middle for Israel and Europe together.
