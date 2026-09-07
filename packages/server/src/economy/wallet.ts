import type { Db, LedgerCurrency } from '../db/repo.js';
import { HttpError } from '../util/errors.js';
import { newId } from '../util/ids.js';
import type { Clock } from '../util/time.js';

export interface WalletDTO {
  coins: number;
  gems: number;
}

export class InsufficientFunds extends HttpError {
  constructor(currency: LedgerCurrency, needed: number, have: number) {
    super(409, 'insufficient_funds', `not enough ${currency}: need ${needed}, have ${have}`);
  }
}

/** The only place balances change. Every mutation writes a ledger row inside a transaction. */
export class WalletService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  get(userId: string): WalletDTO {
    const w = this.db.wallets.get(userId);
    return { coins: w?.coins ?? 0, gems: w?.gems ?? 0 };
  }

  credit(userId: string, currency: LedgerCurrency, amount: number, reason: string, ref: string | null = null): WalletDTO {
    return this.apply(userId, currency, Math.floor(amount), reason, ref);
  }

  /** Throws `InsufficientFunds` when the balance would go negative. */
  debit(userId: string, currency: LedgerCurrency, amount: number, reason: string, ref: string | null = null): WalletDTO {
    return this.apply(userId, currency, -Math.floor(amount), reason, ref);
  }

  private apply(userId: string, currency: LedgerCurrency, delta: number, reason: string, ref: string | null): WalletDTO {
    if (!Number.isFinite(delta)) throw new HttpError(400, 'bad_amount', 'amount must be finite');
    if (delta === 0) return this.get(userId);
    return this.db.transaction(() => {
      const w = this.db.wallets.get(userId) ?? { userId, coins: 0, gems: 0 };
      const next = w[currency] + delta;
      if (next < 0) throw new InsufficientFunds(currency, -delta, w[currency]);
      w[currency] = next;
      this.db.wallets.put(w);
      this.db.ledger.insert({ id: newId(), userId, currency, amount: delta, balanceAfter: next, reason, ref, createdAt: this.clock() });
      return { coins: w.coins, gems: w.gems };
    });
  }
}
