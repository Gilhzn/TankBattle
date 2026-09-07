import type { OrderRow } from '../../db/repo.js';
import { HttpError } from '../../util/errors.js';
import type { CheckoutResult, PaymentProvider, WebhookResult } from './provider.js';

/** Development provider: the client is redirected to an in-app fake checkout page. */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createCheckout(order: OrderRow): Promise<CheckoutResult> {
    return { redirectUrl: `/#/checkout/${order.id}` };
  }

  async parseWebhook(): Promise<WebhookResult | null> {
    throw new HttpError(404, 'not_found', 'no webhook for the mock provider');
  }
}
