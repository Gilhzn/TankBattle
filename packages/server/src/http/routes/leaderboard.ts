import type { App } from '../../app.js';
import type { MatchMode, MatchResultRow } from '../../db/repo.js';
import { badRequest } from '../../util/errors.js';
import type { Router } from '../router.js';

export interface LeaderEntry {
  rank: number;
  name: string;
  score: number;
  stage: number;
  mode: string;
}

const MODES: MatchMode[] = ['solo', 'coop', 'versus'];
const TOP = 50;

export function registerLeaderboardRoutes(r: Router, app: App): void {
  r.get('/api/leaderboard', (ctx) => {
    const mode = (ctx.query.get('mode') ?? 'solo') as MatchMode;
    if (!MODES.includes(mode)) throw badRequest('mode must be solo|coop|versus', 'bad_mode');
    const rows = app.db.matches.bestPerUser(mode);
    const entry = (row: MatchResultRow, i: number): LeaderEntry => ({ rank: i + 1, name: app.db.users.get(row.userId)?.nickname ?? 'unknown', score: row.score, stage: row.stage, mode });
    const entries = rows.slice(0, TOP).map(entry);
    const myIdx = rows.findIndex((row) => row.userId === ctx.user.id);
    return myIdx >= 0 ? { entries, me: entry(rows[myIdx], myIdx) } : { entries };
  });
}
