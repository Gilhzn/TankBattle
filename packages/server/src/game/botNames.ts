/**
 * Names for fill-in opponents.
 *
 * They have to read like the names real players actually pick, because a lobby full of
 * "Player_4471" is its own kind of tell. Each pool mixes given names, gamer handles and the
 * handle+number pattern that dominates any real leaderboard, drawn from the region the human is
 * playing in so the opponent list looks like their neighbours rather than a random sample.
 */

export type NameRegion = 'il' | 'global';

interface Pool {
  /** Bare handles, used as-is. */
  handles: string[];
  /** Handles that read naturally with digits appended. */
  stems: string[];
}

const POOLS: Record<NameRegion, Pool> = {
  il: {
    handles: [
      'Yuval', 'Noam', 'Shira', 'Itay', 'Maayan', 'Ori', 'Roni', 'Adi', 'Guy', 'Tamar',
      'Eitan', 'Lior', 'Omer', 'Dana', 'Nadav', 'Shai', 'Alon', 'Yarden', 'Amit', 'Gal',
      'ShayTheKing', 'OmerPlays', 'TankiIL', 'BarakX', 'NoaGG',
    ],
    stems: ['Yuval', 'Noam', 'Itay', 'Omer', 'Gal', 'Alon', 'Shai', 'Amit', 'Roni', 'Lior', 'Tanki', 'Barak'],
  },
  global: {
    handles: [
      'Kestrel', 'mikkoo', 'DrizzyT', 'panzerfaust', 'Nyx', 'ovechkin_', 'quietstorm', 'Vex',
      'BlueOni', 'sardine', 'Halcyon', 'mrkrabs', 'Tundra', 'zephyrr', 'GoodGrief', 'Pilsner',
      'notacat', 'Rook', 'stellar', 'Munich', 'twelveoclock', 'Bramble',
    ],
    stems: ['Kestrel', 'Tundra', 'Vex', 'Rook', 'Nyx', 'Bramble', 'Halcyon', 'Pilsner', 'Munich', 'zephyr', 'drizzy', 'oni'],
  },
};

/** Regions we have a name pool for, keyed by ISO country code. */
const REGION_BY_COUNTRY: Record<string, NameRegion> = { IL: 'il' };

export function regionFor(country: string | undefined): NameRegion {
  return REGION_BY_COUNTRY[(country ?? '').toUpperCase()] ?? 'global';
}

const pick = <T>(arr: T[], rnd: () => number): T => arr[Math.floor(rnd() * arr.length)];

/**
 * A plausible name for an opponent from `region`, avoiding anything in `taken` (the nicknames
 * already in the room, so a bot never shares a name with the player it is facing).
 */
export function botName(region: NameRegion, taken: Set<string> = new Set(), rnd: () => number = Math.random): string {
  const pool = POOLS[region] ?? POOLS.global;
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  for (let attempt = 0; attempt < 40; attempt++) {
    // Roughly half of real handles carry digits, so the mix is deliberate rather than incidental.
    const name = rnd() < 0.45 ? pick(pool.handles, rnd) : `${pick(pool.stems, rnd)}${Math.floor(rnd() * 900) + 10}`;
    if (!lower.has(name.toLowerCase())) return name;
  }
  return `${pick(pool.stems, rnd)}${Math.floor(rnd() * 9000) + 1000}`;
}
