import { guestAuthSchema, patchMeSchema } from '@tank/shared';
import type { App } from '../../app.js';
import { userDto } from '../../auth/users.js';
import { cosmeticCategory } from '../../economy/inventory.js';
import { parseBody, type Router } from '../router.js';

export function registerAuthRoutes(r: Router, app: App): void {
  r.post('/api/auth/guest', (ctx) => {
    const body = parseBody(guestAuthSchema, ctx.body);
    return app.users.guest(body.deviceToken, body.nickname);
  }, { auth: false, cost: 2 });

  r.get('/api/me', (ctx) => {
    const id = ctx.user.id;
    app.users.touch(id);
    return {
      user: userDto(ctx.user),
      wallet: app.wallet.get(id),
      inventory: app.inventory.list(id),
      battlepass: app.battlepass.get(id),
      daily: app.rewards.daily(id),
      stats: app.db.matches.stats(id),
      pendingGifts: app.gifts.pendingCount(id),
      provider: app.provider.name,
    };
  });

  r.patch('/api/me', (ctx) => {
    const body = parseBody(patchMeSchema, ctx.body);
    const id = ctx.user.id;
    let user = ctx.user;
    app.db.transaction(() => {
      if (body.nickname !== undefined) user = app.users.setNickname(id, body.nickname);
      if (body.skin !== undefined) {
        user = app.users.setSkin(id, body.skin, (sku) => app.inventory.qty(id, sku) > 0);
        if (body.skin === 'default') app.inventory.unequipCategory(id, cosmeticCategory('skin_'));
        else app.inventory.equip(id, body.skin);
      }
      if (body.settings !== undefined) user = app.users.setSettings(id, body.settings);
    });
    return { user: userDto(user) };
  });
}
