import type { App } from '../../app.js';
import type { Router } from '../router.js';
import { registerAccountRoutes } from './account.js';
import { registerAuthRoutes } from './auth.js';
import { registerFriendRoutes } from './friends.js';
import { registerProfileRoutes } from './profile.js';
import { registerGiftRoutes } from './gifts.js';
import { registerHealthRoutes } from './health.js';
import { registerLeaderboardRoutes } from './leaderboard.js';
import { registerRewardRoutes } from './rewards.js';
import { registerSoloRoutes } from './solo.js';
import { registerStoreRoutes } from './store.js';

export function registerRoutes(r: Router, app: App): void {
  registerHealthRoutes(r, app);
  registerAuthRoutes(r, app);
  registerAccountRoutes(r, app);
  registerFriendRoutes(r, app);
  registerProfileRoutes(r, app);
  registerStoreRoutes(r, app);
  registerRewardRoutes(r, app);
  registerGiftRoutes(r, app);
  registerSoloRoutes(r, app);
  registerLeaderboardRoutes(r, app);
}
