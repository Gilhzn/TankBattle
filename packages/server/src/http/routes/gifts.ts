import { giftSendSchema } from '@tank/shared';
import type { App } from '../../app.js';
import { parseBody, type Router } from '../router.js';

export function registerGiftRoutes(r: Router, app: App): void {
  r.post('/api/gifts/send', (ctx) => {
    const body = parseBody(giftSendSchema, ctx.body);
    return app.gifts.send(ctx.user.id, body.to, body.sku, body.qty, body.message ?? '');
  });
  r.get('/api/gifts/inbox', (ctx) => ({ gifts: app.gifts.inbox(ctx.user.id) }));
  r.post('/api/gifts/:id/claim', (ctx) => app.gifts.claim(ctx.user.id, ctx.params.id));
}
