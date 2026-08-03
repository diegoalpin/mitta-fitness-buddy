/**
 * The browser twin of backend/src/log.ts — same line format, same field style,
 * so a DevTools line and a terminal line for the same request read alike:
 *
 *   14:22:07.401 info  chat  request turns=3 text="how did my..."
 *   14:22:07.462 info  chat  response status=200 req=8f3a1c04 ms=61
 *
 * `req` comes from the backend's X-Request-Id header. Search that id in the
 * backend terminal to get the server's side of the same exchange.
 *
 * These logs go to the browser console, NOT to the terminal running `vite`.
 * That terminal is the dev server; it never sees the app's runtime. Getting
 * browser logs into a terminal means shipping them over HTTP to the backend,
 * which is a real thing to build but not something to do by default.
 *
 * Level comes from VITE_LOG_LEVEL, falling back to `info` in dev and `warn` in
 * a production build — so a deployed app stays quiet without a build flag.
 */

/** Values render as `key=value`, so keep them scalar. `undefined` is omitted. */
export type Fields = Record<string, string | number | boolean | undefined>;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): LogLevel {
  const raw = import.meta.env.VITE_LOG_LEVEL;
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return import.meta.env.DEV ? 'info' : 'warn';
}

const threshold = RANK[configuredLevel()];

/** UTC, matching the backend logger, so the two sets of lines interleave. */
function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function render(fields?: Fields): string {
  if (!fields) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const text =
      typeof value === 'string' && /[\s"=]/.test(value) ? JSON.stringify(value) : value;
    parts.push(`${key}=${text}`);
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
}

export function createLogger(scope: string): Logger {
  function write(level: LogLevel, message: string, fields?: Fields): void {
    if (RANK[level] < threshold) return;

    const line = `${stamp()} ${level.padEnd(5)} ${scope.padEnd(4)} ${message}${render(fields)}`;

    // console.debug is hidden behind DevTools' "Verbose" filter by default,
    // which is exactly the right home for per-chunk noise.
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else if (level === 'debug') console.debug(line);
    else console.log(line);
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}

/** Collapses text to one truncated line for a log field. */
export function preview(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}
