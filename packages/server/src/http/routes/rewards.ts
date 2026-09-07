import { adCompleteSchema, battlepassClaimSchema } from '@tank/shared';
import { z } from 'zod';
import type { App } from '../../app.js';
import { parseBody, type Router } from '../router.js';

const adStartSchema = z.object({ placement: z.enum(['results', 'menu']).default('menu') });

export function registerRewardRoutes(r: Router, app: App): void {
  r.get('/api/rewards/daily', (ctx) => app.rewards.daily(ctx.user.id));
  r.post('/api/rewards/daily/claim', (ctx) => app.rewards.claimDaily(ctx.user.id));

  r.post('/api/rewards/ad/start', (ctx) => {
    const body = parseBody(adStartSchema, ctx.body);
    return app.rewards.adStart(ctx.user.id, body.placement);
  });
  r.post('/api/rewards/ad/complete', (ctx) => {
    const body = parseBody(adCompleteSchema, ctx.body);
    return app.rewards.adComplete(ctx.user.id, body.adSessionId, body.placement);
  });

  r.get('/api/battlepass', (ctx) => app.battlepass.get(ctx.user.id));
  r.post('/api/battlepass/claim', (ctx) => {
    const body = parseBody(battlepassClaimSchema, ctx.body);
    const id = ctx.user.id;
    const battlepass = app.battlepass.claim(id, body.tier, body.track);
    return { wallet: app.wallet.get(id), inventory: app.inventory.list(id), battlepass };
  });
  r.post('/api/battlepass/premium', (ctx) => {
    const battlepass = app.battlepass.buyPremium(ctx.user.id);
    return { wallet: app.wallet.get(ctx.user.id), battlepass };
  });
}
