import type { App } from '../../app.js';
import type { Router } from '../router.js';

export function registerHealthRoutes(r: Router, app: App): void {
  r.get('/api/health', () => {
    const s = app.rooms.stats();
    return { ok: true, uptime: Math.round((Date.now() - app.startedAt) / 1000), rooms: s.rooms, players: s.players };
  }, { auth: false });
}
