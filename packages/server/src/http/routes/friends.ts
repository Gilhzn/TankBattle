import { friendRequestSchema, inviteAcceptSchema } from '@tank/shared';
import type { App } from '../../app.js';
import { parseBody, type Router } from '../router.js';

export function registerFriendRoutes(r: Router, app: App): void {
  /** The whole friends screen in one call: the list plus both directions of pending requests. */
  r.get('/api/friends', (ctx) => ({
    friends: app.friends.list(ctx.user.id),
    incoming: app.friends.incoming(ctx.user.id),
    outgoing: app.friends.outgoing(ctx.user.id),
  }));

  r.post('/api/friends/request', (ctx) => {
    const body = parseBody(friendRequestSchema, ctx.body);
    return app.friends.request(ctx.user.id, body.nickname);
  }, { cost: 3 });

  r.post('/api/friends/requests/:id/accept', (ctx) => ({ friend: app.friends.accept(ctx.user.id, ctx.params.id) }), { cost: 2 });

  r.post('/api/friends/requests/:id/decline', (ctx) => {
    app.friends.decline(ctx.user.id, ctx.params.id);
    return { ok: true };
  }, { cost: 2 });

  r.post('/api/friends/requests/:id/cancel', (ctx) => {
    app.friends.cancel(ctx.user.id, ctx.params.id);
    return { ok: true };
  }, { cost: 2 });

  r.delete('/api/friends/:id', (ctx) => {
    app.friends.remove(ctx.user.id, ctx.params.id);
    return { ok: true };
  }, { cost: 2 });

  /** A shareable invite link, plus the wa.me URL that opens WhatsApp with it pre-filled. */
  r.get('/api/friends/invite', (ctx) => app.friends.createInvite(ctx.user.id), { cost: 2 });

  /** Opening someone's invite link: sends the request back to whoever shared it. */
  r.post('/api/friends/invite/accept', (ctx) => {
    const body = parseBody(inviteAcceptSchema, ctx.body);
    return app.friends.acceptInvite(ctx.user.id, body.code);
  }, { cost: 3 });
}
