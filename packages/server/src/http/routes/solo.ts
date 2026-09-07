import { soloResultSchema, soloStartSchema } from '@tank/shared';
import type { App } from '../../app.js';
import { parseBody, type Router } from '../router.js';

export function registerSoloRoutes(r: Router, app: App): void {
  r.post('/api/solo/start', (ctx) => {
    const body = parseBody(soloStartSchema, ctx.body);
    return app.solo.start(ctx.user.id, body.loadout, body.stage, body.difficulty);
  });
  // Re-simulation is CPU-bound: charge it heavily against the per-user bucket.
  r.post('/api/solo/result', (ctx) => {
    const body = parseBody(soloResultSchema, ctx.body);
    return app.solo.result(ctx.user.id, body);
  }, { cost: 10 });
}
