import type { App } from '../../app.js';
import type { Router } from '../router.js';

export function registerHealthRoutes(r: Router, app: App): void {
  r.get('/api/health', () => {
    const s = app.rooms.stats();
    return {
      ok: true,
      uptime: Math.round((Date.now() - app.startedAt) / 1000),
      rooms: s.rooms,
      players: s.players,
      // Where this instance is running, which is most of a player's ping. Render sets this on the
      // instance; null anywhere it is not set, in which case the ping in the HUD is the answer.
      region: process.env.RENDER_REGION ?? process.env.REGION ?? null,
    };
  }, { auth: false });
}
