import { Rng } from '../rng.js';
import type { EnemyKind, StageDef } from '../types.js';
import { STAGES } from './stages.js';
import { ENEMIES_PER_STAGE } from '../constants.js';

/** Deterministic procedural stage for stage numbers beyond the authored set: mirrored random layout. */
export function generateStage(stage: number): StageDef {
  const rng = new Rng(0x9e3779b1 ^ (stage * 7919));
  const rows: string[] = [];
  const palette = ['.', '.', '.', '#', '#', '#', '#', '@', '%', '%', '~', '='];
  for (let y = 0; y < 13; y++) {
    const half: string[] = [];
    for (let x = 0; x < 7; x++) {
      let c = '.';
      if (y >= 1 && y <= 11) {
        const roll = rng.int(100);
        if (roll < 55) c = palette[rng.int(palette.length)];
      }
      half.push(c);
    }
    const mirrored = half.slice(0, 6).reverse();
    rows.push(half.join('') + mirrored.join(''));
  }
  // guarantee a vertical corridor in the centre column and in column 4/8 so the map stays traversable
  const open = (r: string, i: number) => r.slice(0, i) + '.' + r.slice(i + 1);
  for (let y = 0; y < 13; y++) {
    if (y % 3 === 0) rows[y] = open(open(rows[y], 4), 8);
  }
  return { name: `Sector ${stage}`, cells: rows, roster: rosterForStage(stage) };
}

export function rosterForStage(stage: number): [EnemyKind, number][] {
  const armor = Math.min(10, 2 + Math.floor(stage / 2));
  const power = Math.min(8, 3 + Math.floor(stage / 3));
  const fast = Math.min(6, 2 + Math.floor(stage / 4));
  const basic = Math.max(0, ENEMIES_PER_STAGE - armor - power - fast);
  return [['basic', basic], ['fast', fast], ['power', power], ['armor', armor]];
}

export function getStageDef(stage: number): StageDef {
  if (stage >= 1 && stage <= STAGES.length) return STAGES[stage - 1];
  return generateStage(stage);
}

export function expandRoster(roster: [EnemyKind, number][]): EnemyKind[] {
  const list: EnemyKind[] = [];
  // interleave kinds so waves feel mixed rather than 18 basics then 2 fasts
  const pools = roster.filter(([, n]) => n > 0).map(([k, n]) => ({ k, n }));
  while (list.length < ENEMIES_PER_STAGE && pools.some((p) => p.n > 0)) {
    for (const p of pools) {
      if (p.n > 0 && list.length < ENEMIES_PER_STAGE) {
        list.push(p.k);
        p.n--;
      }
    }
  }
  while (list.length < ENEMIES_PER_STAGE) list.push('basic');
  return list.slice(0, ENEMIES_PER_STAGE);
}
