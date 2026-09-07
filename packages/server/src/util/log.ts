/** Minimal leveled logger. Levels: debug < info < warn < error < silent. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export interface Logger {
  level: LogLevel;
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  child(prefix: string): Logger;
}

export function createLogger(level: LogLevel = 'info', prefix = ''): Logger {
  const emit = (lvl: LogLevel, msg: string, args: unknown[]) => {
    if (ORDER[lvl] < ORDER[logger.level]) return;
    const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${prefix ? `[${prefix}] ` : ''}${msg}`;
    const fn = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
    fn(line, ...args);
  };
  const logger: Logger = {
    level,
    debug: (m, ...a) => emit('debug', m, a),
    info: (m, ...a) => emit('info', m, a),
    warn: (m, ...a) => emit('warn', m, a),
    error: (m, ...a) => emit('error', m, a),
    child: (p) => {
      const c = createLogger(logger.level, prefix ? `${prefix}:${p}` : p);
      return c;
    },
  };
  return logger;
}
