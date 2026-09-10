/**
 * Everything that names the game, in one place: the menu logo, the document title, the manifest,
 * the store listing and every storage key are derived from these, so the product can be renamed
 * without hunting through the tree for stray copies of its old name.
 *
 * The tagline is *not* here — it is prose and lives in `i18n`, translated like the rest of the UI.
 */
export const BRAND = {
  /** Full product name. A proper noun: it is never translated. */
  name: 'IRONGRID',
  /** Where a name has to fit a home-screen icon or a browser tab strip. */
  short: 'IRONGRID',
  /**
   * Prefix for localStorage keys and service-worker caches. Changing it strands everything already
   * saved on a device, so `storage.ts` migrates the previous prefix rather than bumping this.
   */
  key: 'irongrid',
  /** The two halves the menu logo sets in different metals. */
  logo: ['IRON', 'GRID'],
  /** One sentence for a store listing, the manifest and the page description. */
  description: 'A four-player tank arena on a destructible grid — online co-op and versus, on any device.',
} as const;
