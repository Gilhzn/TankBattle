import type { OrderRow } from '../../db/repo.js';

export interface CheckoutResult {
  redirectUrl?: string;
  clientSecret?: string;
}

export interface WebhookResult {
  orderId: string;
  status: 'completed' | 'failed';
  providerRef?: string;
}

/** Real-money payment backend. Only the webhook path may complete an order. */
export interface PaymentProvider {
  readonly name: 'mock' | 'stripe';
  createCheckout(order: OrderRow, item: { name: string; description: string }): Promise<CheckoutResult>;
  /** Parses & verifies a webhook. Returns null for events that don't concern an order. Throws on bad signatures. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult | null>;
}
