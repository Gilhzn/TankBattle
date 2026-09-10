import { BRAND } from '@tank/shared';

/** The prefix every stored key carried before the game was named. */
const LEGACY_PREFIX = 'tank1990.';

/**
 * A namespaced localStorage key: `storageKey('settings.v1')` is `irongrid.settings.v1`.
 *
 * The first time a name is asked for on a device that still holds the old prefix, the value is
 * carried across. Renaming the product must not sign anyone out, reset their settings or orphan
 * their guest identity, and this is the whole of what makes that true.
 */
export function storageKey(name: string): string {
  const key = `${BRAND.key}.${name}`;
  try {
    if (localStorage.getItem(key) === null) {
      const legacy = localStorage.getItem(LEGACY_PREFIX + name);
      if (legacy !== null) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_PREFIX + name);
      }
    }
  } catch {
    /* storage unavailable (private mode, blocked cookies) — callers already cope with that */
  }
  return key;
}
