import { CATALOG, checkoutSchema, equipSchema, mockCompleteSchema, purchaseSchema } from '@tank/shared';
import type { App } from '../../app.js';
import { userDto } from '../../auth/users.js';
import { orderDto } from '../../economy/orders.js';
import { HttpError, forbidden, notFound } from '../../util/errors.js';
import { parseBody, type Router } from '../router.js';

export function registerStoreRoutes(r: Router, app: App): void {
  r.get('/api/store/catalog', (ctx) => ({ items: CATALOG, ownedOneTime: app.store.ownedOneTime(ctx.user.id), provider: app.provider.name }));

  r.post('/api/store/purchase', (ctx) => {
    const body = parseBody(purchaseSchema, ctx.body);
    return app.store.purchase(ctx.user.id, body.sku, body.qty, body.currency);
  });

  r.post('/api/store/checkout', async (ctx) => {
    const body = parseBody(checkoutSchema, ctx.body);
    return app.store.checkout(ctx.user.id, body.sku);
  }, { cost: 3 });

  r.post('/api/store/mock/complete', (ctx) => {
    if (app.provider.name !== 'mock') throw notFound('mock checkout is disabled', 'not_found');
    const body = parseBody(mockCompleteSchema, ctx.body);
    const order = app.store.get(body.orderId);
    if (order.userId !== ctx.user.id) throw forbidden('not your order', 'not_your_order');
    const done = app.store.fulfil(order.id, 'mock');
    return { order: orderDto(done), wallet: app.wallet.get(ctx.user.id), inventory: app.inventory.list(ctx.user.id) };
  });

  r.post('/api/store/webhook/stripe', async (ctx) => {
    if (app.provider.name !== 'stripe') throw notFound('stripe webhook is disabled', 'not_found');
    const result = await app.provider.parseWebhook(ctx.rawBody, ctx.headers);
    if (result) {
      try {
        if (result.status === 'completed') app.store.fulfil(result.orderId, result.providerRef ?? null);
        else app.store.fail(result.orderId, result.providerRef ?? null);
      } catch (err) {
        // Unknown order ids or already-owned one-time items must not make Stripe retry forever.
        if (!(err instanceof HttpError && (err.status === 404 || err.status === 409))) throw err;
        app.log.warn(`stripe webhook for order ${result.orderId}: ${(err as Error).message}`);
      }
    }
    return { received: true };
  }, { auth: false, raw: true });

  r.get('/api/store/orders', (ctx) => ({ orders: app.store.list(ctx.user.id) }));

  r.get('/api/inventory', (ctx) => ({ inventory: app.inventory.list(ctx.user.id) }));

  r.post('/api/inventory/equip', (ctx) => {
    const body = parseBody(equipSchema, ctx.body);
    const id = ctx.user.id;
    return app.db.transaction(() => {
      const inventory = app.inventory.equip(id, body.sku);
      const user = body.sku.startsWith('skin_') ? app.users.setSkin(id, body.sku, () => true) : ctx.user;
      return { user: userDto(user), inventory };
    });
  });
}
