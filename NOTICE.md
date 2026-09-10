# Notice

Everything in IRONGRID is original to this project.

**Code.** All source in `packages/shared`, `packages/server` and `packages/client` was written for
this game. The only third-party code is the dependencies declared in `package.json`, each used under
its own licence and none of it vendored into this tree.

**Art.** There are no image assets. Every tile, tank, pickup, bullet and particle is drawn at runtime
by our own canvas code in `packages/client/src/render/` — the panels, bulkheads, plasma channels,
crystal canopy, reactor core, the nine tank chassis and the pickup glyphs are all vector geometry in
`sprites.ts`, with the palette in `theme.ts`. The only files under `packages/client/public/icons/`
are the PWA icons, which `scripts/` generates from that same code.

**Audio.** There are no sound files. Every effect is synthesised from oscillators and noise at
runtime in `packages/client/src/audio/`.

**Levels.** All twelve stage layouts in `packages/shared/src/maps/stages.ts` and every versus arena
in `maps/arenas.ts` were authored for this game. The procedural arena generator in `maps/generator.ts`
produces the rest.

**Design.** IRONGRID is a four-player tank arena on a destructible grid. Game mechanics — grid
movement, destructible cover, defending an objective, waves of AI opponents, pickups — are ideas, and
ideas are not owned by anyone. Nothing here reproduces another game's artwork, level data, audio,
code or name.

The name, the logo and the visual language are this project's own.
