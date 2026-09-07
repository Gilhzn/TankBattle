import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OrderRow } from '../../db/repo.js';
import { HttpError, badRequest } from '../../util/errors.js';
import type { Clock } from '../../util/time.js';
import type { CheckoutResult, PaymentProvider, WebhookResult } from './provider.js';

export const STRIPE_TOLERANCE_SEC = 300;

/**
 * Verifies a Stripe `Stripe-Signature` header (`t=...,v1=...`) against the raw body:
 * HMAC-SHA256(secret, `${t}.${body}`), constant-time compare, timestamp within tolerance.
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowMs: number, toleranceSec = STRIPE_TOLERANCE_SEC): boolean {
  if (!header) return false;
  let ts = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't') ts = v ?? '';
    else if (k === 'v1' && v) sigs.push(v);
  }
  const t = Number(ts);
  if (!Number.isFinite(t) || sigs.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest();
  return sigs.some((s) => {
    let given: Buffer;
    try {
      given = Buffer.from(s, 'hex');
    } catch {
      return false;
    }
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface StripeSession {
  id?: string;
  url?: string;
  metadata?: { orderId?: string };
  payment_status?: string;
}

/** Stripe Checkout via the REST API (no SDK). */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly publicUrl: string,
    private readonly clock: Clock,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCheckout(order: OrderRow, item: { name: string; description: string }): Promise<CheckoutResult> {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${this.publicUrl}/#/checkout/${order.id}?status=success`,
      cancel_url: `${this.publicUrl}/#/checkout/${order.id}?status=cancel`,
      client_reference_id: order.id,
      'metadata[orderId]': order.id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': order.currency,
      'line_items[0][price_data][unit_amount]': String(order.amountCents),
      'line_items[0][price_data][product_data][name]': item.name,
      'line_items[0][price_data][product_data][description]': item.description,
    });
    const res = await this.fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const session = (await res.json()) as StripeSession & { error?: { message?: string } };
    if (!res.ok || !session.url) throw new HttpError(502, 'provider_error', session.error?.message ?? 'stripe checkout failed');
    return { redirectUrl: session.url };
  }

  async parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<WebhookResult | null> {
    const sig = headers['stripe-signature'];
    if (!verifyStripeSignature(rawBody, Array.isArray(sig) ? sig[0] : sig, this.webhookSecret, this.clock())) {
      throw badRequest('invalid stripe signature', 'bad_signature');
    }
    let event: { type?: string; data?: { object?: StripeSession } };
    try {
      event = JSON.parse(rawBody) as typeof event;
    } catch {
      throw badRequest('invalid webhook json');
    }
    const session = event.data?.object;
    const orderId = session?.metadata?.orderId;
    if (!orderId) return null;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (session?.payment_status && session.payment_status !== 'paid') return null;
        return { orderId, status: 'completed', providerRef: session?.id };
      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        return { orderId, status: 'failed', providerRef: session?.id };
      default:
        return null;
    }
  }
}
