import type { AccountService } from './auth/accounts.js';
import type { UserService } from './auth/users.js';
import type { FriendsService } from './social/friends.js';
import type { RankingService } from './social/ranking.js';
import type { Presence } from './social/presence.js';
import type { Config } from './config.js';
import type { Db } from './db/repo.js';
import type { BattlepassService } from './economy/battlepass.js';
import type { GiftsService } from './economy/gifts.js';
import type { InventoryService } from './economy/inventory.js';
import type { StoreService } from './economy/orders.js';
import type { PaymentProvider } from './economy/payments/provider.js';
import type { RewardsService } from './economy/rewards.js';
import type { WalletService } from './economy/wallet.js';
import type { ResultsService } from './game/results.js';
import type { SoloService } from './game/solo.js';
import type { RoomManager } from './rooms/roomManager.js';
import type { Logger } from './util/log.js';
import type { Clock } from './util/time.js';

/** Everything the HTTP routes and the WS gateway need, wired once in `server.ts`. */
export interface App {
  config: Config;
  log: Logger;
  clock: Clock;
  db: Db;
  users: UserService;
  accounts: AccountService;
  friends: FriendsService;
  ranking: RankingService;
  presence: Presence;
  wallet: WalletService;
  inventory: InventoryService;
  store: StoreService;
  battlepass: BattlepassService;
  rewards: RewardsService;
  gifts: GiftsService;
  results: ResultsService;
  solo: SoloService;
  provider: PaymentProvider;
  rooms: RoomManager;
  startedAt: number;
}
