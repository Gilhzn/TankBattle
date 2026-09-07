/**
 * Token-bucket rate limiter keyed by an arbitrary string (ip, user id, ...).
 * `capacity` tokens are available at once and refill at `refillPerSec`.
 */
export interface BucketOptions {
  capacity: number;
  refillPerSec: number;
  /** Idle buckets are dropped after this long (ms). */
  ttlMs?: number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    private readonly opts: BucketOptions,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consumes `cost` tokens if available; returns false when the key is over its limit. */
  take(key: string, cost = 1): boolean {
    const t = this.now();
    this.sweep(t);
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.opts.capacity, updated: t };
      this.buckets.set(key, b);
    } else {
      const elapsed = Math.max(0, t - b.updated) / 1000;
      b.tokens = Math.min(this.opts.capacity, b.tokens + elapsed * this.opts.refillPerSec);
      b.updated = t;
    }
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(t: number): void {
    const ttl = this.opts.ttlMs ?? 300_000;
    if (t - this.lastSweep < ttl) return;
    this.lastSweep = t;
    for (const [k, b] of this.buckets) if (t - b.updated > ttl) this.buckets.delete(k);
  }
}
