import { createRequire } from 'node:module';
import type { Logger } from '../util/log.js';
import { createJsonDb } from './json.js';
import { createSqliteDb } from './sqlite.js';
import type { Db } from './repo.js';

export type { Db } from './repo.js';

/**
 * Opens the persistence layer.
 * - `json:<path>` forces the JSON store (`json::memory:` for a pure in-memory one)
 * - otherwise better-sqlite3 is attempted (`:memory:` supported) and the JSON store is the fallback.
 */
export function openDb(path: string, log?: Logger): Db {
  if (path.startsWith('json:')) {
    const p = path.slice('json:'.length);
    return createJsonDb(p === ':memory:' ? null : p);
  }
  const sqlite = loadSqlite();
  if (sqlite) {
    try {
      return createSqliteDb(sqlite, path);
    } catch (err) {
      log?.warn(`sqlite failed to open ${path}: ${(err as Error).message}`);
    }
  } else {
    log?.warn('better-sqlite3 is not available; falling back to the JSON store');
  }
  return createJsonDb(path === ':memory:' ? null : path.replace(/\.db$/, '') + '.json');
}

/** Loads better-sqlite3 lazily so the server still boots when the native module is missing. */
export function loadSqlite(): typeof import('better-sqlite3') | null {
  try {
    const require = createRequire(import.meta.url);
    return require('better-sqlite3') as typeof import('better-sqlite3');
  } catch {
    return null;
  }
}
