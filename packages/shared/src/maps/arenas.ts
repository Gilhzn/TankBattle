import type { StageDef } from '../types.js';
import { ratingBand } from '../rating.js';

/**
 * Versus arenas, one per rating band, so the map changes every 100 rating points as a player climbs.
 *
 * Every arena is symmetric on both axes — each row reads the same backwards, and the rows mirror
 * about the middle — so all four spawn corners are equally defensible and neither side of a 2v2
 * inherits an advantage. The four corner cells stay open because that is where players spawn.
 */
export const ARENAS: StageDef[] = [
  {
    name: 'Crossfire',
    cells: [
      '.............',
      '.##.......##.',
      '.#....#....#.',
      '....@...@....',
      '..#..###..#..',
      '..#..#.#..#..',
      '...#.#=#.#...',
      '..#..#.#..#..',
      '..#..###..#..',
      '....@...@....',
      '.#....#....#.',
      '.##.......##.',
      '.............',
    ],
    roster: [],
  },
  {
    name: 'Frostworks',
    cells: [
      '.............',
      '..=.......=..',
      '.#.##...##.#.',
      '...#..@..#...',
      '.=..#...#..=.',
      '..#...#...#..',
      '.....###.....',
      '..#...#...#..',
      '.=..#...#..=.',
      '...#..@..#...',
      '.#.##...##.#.',
      '..=.......=..',
      '.............',
    ],
    roster: [],
  },
  {
    name: 'Delta Flood',
    cells: [
      '.............',
      '.#..~~~~~..#.',
      '.#....@....#.',
      '...##...##...',
      '.~.#..#..#.~.',
      '.~....#....~.',
      '..##..#..##..',
      '.~....#....~.',
      '.~.#..#..#.~.',
      '...##...##...',
      '.#....@....#.',
      '.#..~~~~~..#.',
      '.............',
    ],
    roster: [],
  },
  {
    name: 'Thicket',
    cells: [
      '.............',
      '..%%.....%%..',
      '.%#%..@..%#%.',
      '..%%.....%%..',
      '....#...#....',
      '.#..#.#.#..#.',
      '..#..###..#..',
      '.#..#.#.#..#.',
      '....#...#....',
      '..%%.....%%..',
      '.%#%..@..%#%.',
      '..%%.....%%..',
      '.............',
    ],
    roster: [],
  },
  {
    name: 'Steel Vault',
    cells: [
      '.............',
      '.@#.......#@.',
      '.#.........#.',
      '...##.#.##...',
      '.#..#...#..#.',
      '.#....@....#.',
      '...#.....#...',
      '.#....@....#.',
      '.#..#...#..#.',
      '...##.#.##...',
      '.#.........#.',
      '.@#.......#@.',
      '.............',
    ],
    roster: [],
  },
  {
    name: 'Causeway',
    cells: [
      '.............',
      '.....#.#.....',
      '.##..#.#..##.',
      '.#~~~~.~~~~#.',
      '..~..###..~..',
      '..~..#@#..~..',
      '..~~~###~~~..',
      '..~..#@#..~..',
      '..~..###..~..',
      '.#~~~~.~~~~#.',
      '.##..#.#..##.',
      '.....#.#.....',
      '.............',
    ],
    roster: [],
  },
  {
    name: 'Ironworks',
    cells: [
      '.............',
      '.#.#.....#.#.',
      '.#.#..@..#.#.',
      '.....###.....',
      '.@..#...#..@.',
      '....#.#.#....',
      '.##.#.#.#.##.',
      '....#.#.#....',
      '.@..#...#..@.',
      '.....###.....',
      '.#.#..@..#.#.',
      '.#.#.....#.#.',
      '.............',
    ],
    roster: [],
  },
  {
    name: 'Glacier',
    cells: [
      '.............',
      '.==.......==.',
      '.=#.......#=.',
      '...##.#.##...',
      '..#..=.=..#..',
      '..#.......#..',
      '...#.===.#...',
      '..#.......#..',
      '..#..=.=..#..',
      '...##.#.##...',
      '.=#.......#=.',
      '.==.......==.',
      '.............',
    ],
    roster: [],
  },
];

/**
 * Index of the arena for a rating — this is what a versus match carries in `stage`. Bands wrap once
 * a player climbs past the last arena.
 */
export function arenaIndexForRating(rating: number): number {
  return ratingBand(rating) % ARENAS.length;
}

/** The arena a player at this rating fights in. */
export function arenaForRating(rating: number): StageDef {
  return ARENAS[arenaIndexForRating(rating)];
}
